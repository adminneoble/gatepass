import { Router } from 'express';
import { all, one, run } from '../db/db.js';
import { checkOtp, endSession, issueOtp, loginSms, requireRole, rolesOf, startSession } from '../auth.js';
import { personByMobile, society, unitsOf } from '../domain.js';
import { HttpError, notFound } from '../lib/errors.js';
import { invalidate, subscribe } from '../lib/realtime.js';
import { readPassToken } from '../lib/crypto.js';
import { dataUrlImage, mobile, name, parse, z } from '../lib/validate.js';
import { config } from '../config.js';
import { nowIso } from '../lib/time.js';
import { passView, type PassRow } from '../views.js';

export const core = Router();

const initials = (n: string) => n.split(/\s+/).filter(Boolean).map(w => w[0]).join('').slice(0, 2).toUpperCase();
const brand = () => { const s = society(); return { name: s.name, logo: s.logo, initials: initials(s.name) }; };

// ── Auth ─────────────────────────────────────────────────────────────────────

core.post('/auth/otp', (req, res) => {
  const { mobile: m } = parse(z.object({ mobile }), req.body);
  const p = personByMobile(m);
  if (!p || rolesOf(p.id).length === 0) throw new HttpError(404, `This number isn't registered with ${society().name}. Ask your society admin to add you.`);
  const code = issueOtp(m, 'login', loginSms);
  res.json({ sent: true, ...(config.isProd ? {} : { devCode: code }) });
});

core.post('/auth/verify', (req, res) => {
  const { mobile: m, code } = parse(z.object({ mobile, code: z.string().regex(/^\d{4}$/, 'Enter the 4-digit code.') }), req.body);
  checkOtp(m, 'login', code);
  const p = personByMobile(m)!;
  startSession(res, p.id);
  res.json({ user: { ...p, roles: rolesOf(p.id) } });
});

core.post('/auth/logout', (req, res) => { endSession(req, res); res.json({ ok: true }); });

core.get('/auth/me', (req, res) => {
  if (!req.user) return res.json({ user: null, society: brand() });
  res.json({ user: { ...req.user, units: unitsOf(req.user.id).map(u => u.id) }, society: brand() });
});

core.get('/stream', requireRole(), (req, res) => subscribe(res, req.user!.id, req.user!.roles));

// ── Society ──────────────────────────────────────────────────────────────────

core.get('/society/brand', (_req, res) => res.json(brand()));

core.get('/society', requireRole(), (_req, res) => {
  const s = society();
  res.json({
    ...brand(), gatePhone: s.gate_phone, supervisorName: s.supervisor_name, supervisorPhone: s.supervisor_phone,
    otpRequired: !!s.otp_required, autoSharePass: !!s.auto_share_pass, passValidity: s.pass_validity,
  });
});

core.patch('/society', requireRole('admin'), (req, res) => {
  const b = parse(z.object({
    name: name.optional(),
    logo: dataUrlImage.nullable().optional(),
    gatePhone: mobile.optional(),
    supervisorName: name.optional(),
    supervisorPhone: mobile.optional(),
    otpRequired: z.boolean().optional(),
    autoSharePass: z.boolean().optional(),
    passValidity: z.enum(['4 hours', '24 hours', '3 days']).optional(),
  }), req.body);
  const cols: Record<string, unknown> = {
    name: b.name, logo: b.logo, gate_phone: b.gatePhone, supervisor_name: b.supervisorName, supervisor_phone: b.supervisorPhone,
    otp_required: b.otpRequired === undefined ? undefined : +b.otpRequired,
    auto_share_pass: b.autoSharePass === undefined ? undefined : +b.autoSharePass,
    pass_validity: b.passValidity,
  };
  const set = Object.entries(cols).filter(([, v]) => v !== undefined);
  if (set.length) run(`UPDATE society SET ${set.map(([k]) => k + ' = ?').join(', ')}, updated_at = ? WHERE id = 1`, ...set.map(([, v]) => v), nowIso());
  invalidate('society');
  res.json({ ok: true });
});

// ── Visitor pass page (public, token-gated) ──────────────────────────────────

core.get('/p/:token', (req, res) => {
  const id = readPassToken(req.params.token);
  const p = id && one<PassRow>('SELECT * FROM passes WHERE id = ?', id);
  if (!p) throw notFound('This pass link is not valid.');
  const v = passView(p);
  res.json({ society: brand(), pass: { name: v.name, code: v.code, unitId: v.unitId, purpose: v.purpose, validLabel: v.validLabel, state: v.state, token: v.token } });
});

// ── Development SMS inbox (stands in for the visitor's phone) ────────────────

if (!config.isProd) {
  core.get('/dev/sms', (req, res) => {
    const to = typeof req.query.mobile === 'string' ? req.query.mobile : '';
    const threads = all<{ to_mobile: string; n: number; last: string }>('SELECT to_mobile, COUNT(*) n, MAX(created_at) last FROM sms_outbox GROUP BY to_mobile ORDER BY last DESC');
    const messages = to ? all('SELECT id, to_mobile AS "to", body, link, created_at AS at FROM sms_outbox WHERE to_mobile = ? ORDER BY id', to) : [];
    res.json({ sender: config.smsSender, threads, messages });
  });
}
