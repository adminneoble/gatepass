import { createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import { config } from '../config.js';

export const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
export const randomToken = () => randomBytes(32).toString('base64url');
export const randomDigits = (n: number) => String(randomInt(0, 10 ** n)).padStart(n, '0');

const sign = (data: string) => createHmac('sha256', config.secret).update(data).digest('base64url').slice(0, 22);

/** Opaque, unguessable token for a pass: used in the SMS link and encoded in the QR. */
export const passToken = (passId: number) => `${passId.toString(36)}.${sign('pass:' + passId)}`;

export function readPassToken(token: string): number | null {
  const m = /^([0-9a-z]+)\.([\w-]{22})$/.exec(token.trim());
  if (!m) return null;
  const id = parseInt(m[1], 36);
  const want = Buffer.from(sign('pass:' + id));
  const got = Buffer.from(m[2]);
  return want.length === got.length && timingSafeEqual(want, got) ? id : null;
}
