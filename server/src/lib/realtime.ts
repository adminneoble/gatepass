import { createHmac } from 'node:crypto';
import { config } from '../config.js';

/**
 * Live updates over Supabase Realtime broadcast. Events are queued while a request runs and
 * sent in one `realtime.send` call before the response goes out (see flush in app.ts).
 * Channel names are derived from the server secret, so only signed-in users (who get theirs
 * from /auth/me) know which channels to join.
 */

/** Query groups the web client caches; a change event tells clients which to refetch. */
export type Topic = 'visits' | 'passes' | 'alerts' | 'units' | 'requests' | 'society' | 'events' | 'notifications' | 'me' | 'sms' | 'notices';
type Notify = { text: string; tone?: 'info' | 'alert'; link?: string };
type Message = { topic: string; event: 'invalidate' | 'notify'; payload: unknown };

const channel = (scope: string) => 'gp-' + createHmac('sha256', config.secret).update('rt:' + scope).digest('hex').slice(0, 24);

/** Channels a signed-in person listens on. */
export const channelsFor = (personId: number, roles: string[]) => ({
  all: channel('all'),
  me: channel('person:' + personId),
  roles: roles.filter(r => r === 'security' || r === 'admin').map(r => channel('role:' + r)),
});

let queue: Message[] = [];

/** Tell every signed-in client which cached data changed. Payload carries no data. */
export function invalidate(...topics: Topic[]) {
  queue.push({ topic: channel('all'), event: 'invalidate', payload: topics });
}

/** Ephemeral banner for specific people (members). */
export function pushToPeople(personIds: number[], payload: Notify) {
  for (const id of new Set(personIds)) queue.push({ topic: channel('person:' + id), event: 'notify', payload });
}

/** Ephemeral banner for everyone holding a staff role (e.g. all security devices). */
export function pushToRole(role: 'security' | 'admin', payload: Notify) {
  queue.push({ topic: channel('role:' + role), event: 'notify', payload });
}

/** Force-refresh sessions for a person whose identity/roles changed. */
export function refreshPerson(personId: number) {
  queue.push({ topic: channel('person:' + personId), event: 'invalidate', payload: ['me'] });
}

/** How queued messages leave the server. Supabase: realtime.send(); tests: a no-op or a spy. */
export type Publisher = (messages: Message[]) => Promise<void>;
let publisher: Publisher = async () => {};
export const setPublisher = (p: Publisher) => { publisher = p; };

/** Send everything queued so far. Never throws: a missed live update must not fail the request. */
export async function flush() {
  if (!queue.length) return;
  const batch = queue; queue = [];
  // Collapse duplicate invalidations per channel.
  const merged = new Map<string, Message>();
  for (const m of batch) {
    if (m.event !== 'invalidate') { merged.set(Math.random().toString(36), m); continue; }
    const k = m.topic + '|inv', ex = merged.get(k);
    merged.set(k, ex ? { ...m, payload: [...new Set([...(ex.payload as string[]), ...(m.payload as string[])])] } : m);
  }
  try { await publisher([...merged.values()]); } catch (err) { console.error('Realtime publish failed', err); }
}
