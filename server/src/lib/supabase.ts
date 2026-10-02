import { run } from '../db/db.js';
import type { Publisher } from './realtime.js';

/** Publish broadcasts with Supabase's realtime.send() in one round trip. */
export const realtimeSend: Publisher = async messages => {
  await run(
    `SELECT realtime.send(m.payload, m.event, m.topic, false)
     FROM jsonb_to_recordset((?::text)::jsonb) AS m(topic text, event text, payload jsonb)`,
    JSON.stringify(messages),
  );
};
