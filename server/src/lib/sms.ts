import { run } from '../db/db.js';
import { nowIso } from './time.js';
import { config } from '../config.js';
import { invalidate } from './realtime.js';

/**
 * SMS delivery. Every message is written to sms_outbox (audit + dev inbox).
 * Plug a real gateway (MSG91, Gupshup, Twilio…) in `deliver`; it must be DLT-registered in India.
 */
export interface SmsProvider { deliver(to: string, body: string): Promise<void> }

const consoleProvider: SmsProvider = {
  async deliver(to, body) { if (!config.isProd) console.log(`[sms → ${to}] ${body}`); },
};

let provider: SmsProvider = consoleProvider;
export const setSmsProvider = (p: SmsProvider) => { provider = p; };

export function sendSms(to: string, body: string, link?: string) {
  const full = link ? `${body} ${link}` : body;
  const id = run('INSERT INTO sms_outbox (to_mobile, body, link, created_at) VALUES (?, ?, ?, ?)', to, body, link ?? null, nowIso()).lastInsertRowid;
  provider.deliver(to, full)
    .then(() => run("UPDATE sms_outbox SET status = 'sent' WHERE id = ?", id))
    .catch(err => { console.error('SMS delivery failed', err); run("UPDATE sms_outbox SET status = 'failed' WHERE id = ?", id); });
  invalidate('sms');
}
