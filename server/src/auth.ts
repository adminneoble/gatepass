import type { NextFunction, Request, Response } from 'express';
import { all, one, run } from './db/db.js';
import { config } from './config.js';
import { randomDigits, randomToken, sha256 } from './lib/crypto.js';
import { HttpError, bad } from './lib/errors.js';
import { nowIso } from './lib/time.js';
import { sendSms } from './lib/sms.js';
import { society, type Person } from './domain.js';

export type Role = 'admin' | 'security' | 'member';
export type User = Person & { roles: Role[] };

declare global {
  namespace Express { interface Request { user?: User } }
}

const COOKIE = 'gp_session';

export async function rolesOf(personId: number): Promise<Role[]> {
  const staff = (await all<{ role: Role }>('SELECT role FROM staff WHERE person_id = ?', personId)).map(r => r.role);
  const member = await one('SELECT 1 FROM units WHERE owner_id = ? OR tenant_id = ? LIMIT 1', personId, personId);
  return [...staff, ...(member ? (['member'] as const) : [])];
}

// ── OTP ──────────────────────────────────────────────────────────────────────

type OtpPurpose = 'login' | 'visitor' | 'mobile_change';

/** Issue a 4-digit OTP by SMS. A short resend wait stops double taps. Returns the code (for dev echo only). */
export async function issueOtp(mobile: string, purpose: OtpPurpose, smsText: (code: string) => string | Promise<string>) {
  const last = await one<{ created_at: string }>('SELECT created_at FROM otps WHERE mobile = ? AND purpose = ? ORDER BY id DESC LIMIT 1', mobile, purpose);
  if (last && Date.now() - Date.parse(last.created_at) < 20e3) throw new HttpError(429, 'Please wait a few seconds before requesting another code.');

  const code = randomDigits(4);
  const expires = new Date(Date.now() + config.otpTtlMinutes * 60e3).toISOString();
  await run('UPDATE otps SET used_at = ? WHERE mobile = ? AND purpose = ? AND used_at IS NULL', nowIso(), mobile, purpose);
  await run('INSERT INTO otps (mobile, purpose, code_hash, expires_at, created_at) VALUES (?, ?, ?, ?, ?)', mobile, purpose, sha256(mobile + ':' + code), expires, nowIso());
  await sendSms(mobile, await smsText(code));
  return code;
}

/** Check and consume an OTP. Throws a user-facing error on failure. */
export async function checkOtp(mobile: string, purpose: OtpPurpose, code: string) {
  const row = await one<{ id: number; code_hash: string; expires_at: string; attempts: number }>(
    'SELECT id, code_hash, expires_at, attempts FROM otps WHERE mobile = ? AND purpose = ? AND used_at IS NULL ORDER BY id DESC LIMIT 1',
    mobile, purpose,
  );
  if (!row || Date.parse(row.expires_at) < Date.now()) throw bad('That code has expired. Request a new one.', 'otp_expired');
  if (row.attempts >= config.otpMaxAttempts) throw bad('Too many wrong attempts. Request a new code.', 'otp_locked');
  if (row.code_hash !== sha256(mobile + ':' + code)) {
    await run('UPDATE otps SET attempts = attempts + 1 WHERE id = ?', row.id);
    throw bad('That code is incorrect.', 'otp_wrong');
  }
  await run('UPDATE otps SET used_at = ? WHERE id = ?', nowIso(), row.id);
}

export const loginSms = async (code: string) => `${code} is your ${(await society()).name} Gatepass sign-in code. Do not share it.`;

// ── Sessions ─────────────────────────────────────────────────────────────────

// Sessions never expire on the server; they end only when the user signs out.
export const SESSION_NEVER = '9999-12-31T23:59:59.000Z';
// Browsers cap cookie lifetime (~400 days), so the cookie is re-issued on every signed-in request.
const COOKIE_MAX_AGE = 400 * 864e5;
const setCookie = (res: Response, token: string) =>
  res.cookie(COOKIE, token, { httpOnly: true, sameSite: 'lax', secure: config.isProd, maxAge: COOKIE_MAX_AGE, path: '/' });

export async function startSession(res: Response, personId: number) {
  const token = randomToken();
  await run('INSERT INTO sessions (token_hash, person_id, created_at, expires_at) VALUES (?, ?, ?, ?)', sha256(token), personId, nowIso(), SESSION_NEVER);
  setCookie(res, token);
}

export async function endSession(req: Request, res: Response) {
  const t = req.cookies?.[COOKIE];
  if (t) await run('DELETE FROM sessions WHERE token_hash = ?', sha256(t));
  res.clearCookie(COOKIE, { path: '/' });
}

/** Attach req.user when a valid session cookie is present. */
export async function loadUser(req: Request, res: Response, next: NextFunction) {
  const t = req.cookies?.[COOKIE];
  if (t) {
    // One round trip: person plus roles (same rules as rolesOf).
    const u = await one<Person & { staff: Role[]; member: boolean }>(
      `SELECT p.id, p.name, p.mobile,
              ARRAY(SELECT role FROM staff WHERE person_id = p.id) AS staff,
              EXISTS (SELECT 1 FROM units WHERE owner_id = p.id OR tenant_id = p.id) AS member
       FROM sessions s JOIN people p ON p.id = s.person_id WHERE s.token_hash = ?`, sha256(t));
    if (u) {
      const { staff, member, ...p } = u;
      req.user = { ...p, roles: [...staff, ...(member ? (['member'] as const) : [])] };
      setCookie(res, t); // rolling renewal
    }
  }
  next();
}

/** Raw session token from the cookie (used to keep the caller signed in across a demo reset). */
export const sessionToken = (req: Request): string | undefined => req.cookies?.[COOKIE];

export function requireRole(...roles: Role[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) return next(new HttpError(401, 'Please sign in.'));
    if (roles.length && !roles.some(r => req.user!.roles.includes(r))) return next(new HttpError(403, 'Your account does not have access to this.'));
    next();
  };
}
