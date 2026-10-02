// Supabase Edge Function entry. Bundled by scripts/build-edge.mjs into supabase/functions/api/index.js.
// The function is named `api`, so it receives paths like /api/auth/me — the same paths as in Node.
import { config } from './config.js';
import { setDriver } from './db/db.js';
import { pgDriver } from './db/pg.js';
import { setPublisher } from './lib/realtime.js';
import { realtimeSend } from './lib/supabase.js';
import { createApp } from './app.js';

declare const Deno: { env: { get(k: string): string | undefined } };

const env = (k: string) => Deno.env.get(k);
config.isProd = true;
config.demo = env('GATEPASS_DEMO') !== '0';           // demo prototype: on unless explicitly disabled
if (env('PUBLIC_URL')) { config.publicUrl = env('PUBLIC_URL')!.replace(/\/$/, ''); config.publicUrlFixed = true; }
if (env('GATEPASS_SECRET')) config.secret = env('GATEPASS_SECRET')!;

setDriver(pgDriver(env('SUPABASE_DB_URL')!, Number(env('PG_POOL_MAX') ?? 5)));
setPublisher(realtimeSend);

createApp().listen(8000);
