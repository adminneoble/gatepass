import { config } from '../config.js';

const dayFmt = new Intl.DateTimeFormat('en-CA', { timeZone: config.timeZone, year: 'numeric', month: '2-digit', day: '2-digit' });
const timeFmt = new Intl.DateTimeFormat('en-GB', { timeZone: config.timeZone, hour: '2-digit', minute: '2-digit', hour12: false });
const labelFmt = new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', weekday: 'short', day: 'numeric', month: 'short' });

export const nowIso = () => new Date().toISOString();
/** Society-local YYYY-MM-DD for an instant. */
export const localDay = (d: Date = new Date()) => dayFmt.format(d);
/** Society-local HH:MM for an instant. */
export const localTime = (d: Date | string) => timeFmt.format(typeof d === 'string' ? new Date(d) : d);
/** Add n days to a YYYY-MM-DD string. */
export const addDays = (day: string, n: number) => {
  const d = new Date(day + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
/** "Fri, 2 Oct" for a YYYY-MM-DD string. */
export const dayLabel = (day: string) => labelFmt.format(new Date(day + 'T00:00:00Z'));

/** Offset (ms) of the society timezone from UTC at the given instant. */
function tzOffset(at: Date) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', { timeZone: config.timeZone, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric' })
      .formatToParts(at).map(p => [p.type, p.value]),
  );
  const asUtc = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second);
  return asUtc - Math.floor(at.getTime() / 1000) * 1000;
}
/** UTC instant of local midnight starting `day`. */
export const startOfDay = (day: string) => {
  const guess = new Date(day + 'T00:00:00Z');
  return new Date(guess.getTime() - tzOffset(guess));
};
/** UTC instant of the last second of local `day`. */
export const endOfDay = (day: string) => new Date(startOfDay(addDays(day, 1)).getTime() - 1000);

export const VALIDITY_MS: Record<string, number> = { '4 hours': 4 * 3600e3, '24 hours': 24 * 3600e3, '3 days': 72 * 3600e3 };

const stampFmt = new Intl.DateTimeFormat('en-GB', { timeZone: config.timeZone, weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
/** "Fri, 2 Oct 2026, 16:19:05" in society time. */
export const fullStamp = (iso: string) => stampFmt.format(new Date(iso));
