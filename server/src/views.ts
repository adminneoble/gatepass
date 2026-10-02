import { addDays, dayLabel, localDay, localTime } from './lib/time.js';
import { passToken } from './lib/crypto.js';
import { config } from './config.js';

export type VisitRow = {
  id: number; name: string; mobile: string; unit_id: string; purpose: string; photo: string | null;
  status: 'pending' | 'approved' | 'denied' | 'inside' | 'exited'; via: 'Walk-in' | 'Pass'; pass_id: number | null;
  day: string; created_at: string; decided_by: number | null; decided_at: string | null; entered_at: string | null; exited_at: string | null;
};

export type PassRow = {
  id: number; code: string; name: string; mobile: string; unit_id: string; purpose: string; validity: string;
  valid_from: string; valid_until: string; reusable: number; sent: number; used_at: string | null; revoked_at: string | null; time_slot: string | null; created_at: string;
};

export function visitView(v: VisitRow) {
  return {
    id: v.id, name: v.name, mobile: v.mobile, unitId: v.unit_id, purpose: v.purpose, status: v.status, via: v.via,
    day: v.day, time: localTime(v.created_at),
    enteredAt: v.entered_at && localTime(v.entered_at), exitedAt: v.exited_at && localTime(v.exited_at),
    photoUrl: v.photo ? `/api/visits/${v.id}/photo` : null,
  };
}
export type VisitView = ReturnType<typeof visitView>;

/** "Today", "Tomorrow" or "Sat, 4 Oct" relative to the society's today. */
export function relDay(day: string) {
  const today = localDay();
  return day === today ? 'Today' : day === addDays(today, 1) ? 'Tomorrow' : dayLabel(day);
}

export type PassState = 'valid' | 'used' | 'expired' | 'upcoming' | 'revoked';

export function passState(p: PassRow, now = Date.now()): PassState {
  if (p.revoked_at) return 'revoked';
  if (p.used_at && !p.reusable) return 'used';
  if (Date.parse(p.valid_until) < now) return 'expired';
  if (Date.parse(p.valid_from) > now) return 'upcoming';
  return 'valid';
}

export function passValidLabel(p: PassRow) {
  const untilDay = localDay(new Date(p.valid_until));
  if (p.reusable) return `Valid until ${dayLabel(untilDay)}`;
  if (p.time_slot) return `${relDay(localDay(new Date(p.valid_from)))} · ${p.time_slot}`;
  return `${relDay(localDay(new Date(p.valid_from)))} · valid ${p.validity}`;
}

export function passView(p: PassRow) {
  const token = passToken(p.id);
  return {
    id: p.id, code: p.code, name: p.name, mobile: p.mobile, unitId: p.unit_id, purpose: p.purpose,
    validLabel: passValidLabel(p), validUntil: p.valid_until, timeSlot: p.time_slot, reusable: !!p.reusable, sent: !!p.sent,
    state: passState(p), usedAt: p.used_at && localTime(p.used_at), revokedAt: p.revoked_at && localTime(p.revoked_at),
    token, url: `${config.publicUrl}/p/${token}`,
  };
}
export type PassView = ReturnType<typeof passView>;
