import { run } from '../db/db.js';
import type { Publisher } from './realtime.js';

/**
 * Publish broadcasts with Supabase's realtime.send() in one round trip.
 * realtime.send() adds an `id` key to the payload and silently drops anything that isn't a JSON
 * object, so invalidation topic lists go out as { topics: [...] } (see web/src/lib/live.ts).
 */
export const realtimeSend: Publisher = async messages => {
  await run(
    `SELECT realtime.send(m.payload, m.event, m.topic, false)
     FROM jsonb_to_recordset((?::text)::jsonb) AS m(topic text, event text, payload jsonb)`,
    JSON.stringify(messages.map(m => (Array.isArray(m.payload) ? { ...m, payload: { topics: m.payload } } : m))),
  );
};
