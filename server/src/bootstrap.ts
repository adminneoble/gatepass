import { randomBytes } from 'node:crypto';
import { config } from './config.js';
import { one, run, tx } from './db/db.js';
import { seed } from './db/seed.js';

/** Load the signing secret from the database, creating it on first start. */
export async function loadSecret() {
  if (config.secret) return;
  await run("INSERT INTO app_settings (key, value) VALUES ('secret', ?) ON CONFLICT (key) DO NOTHING", randomBytes(32).toString('base64url'));
  config.secret = (await one<{ value: string }>("SELECT value FROM app_settings WHERE key = 'secret'"))!.value;
}

/** Seed the demo society once. The advisory lock stops two cold starts seeding at the same time. */
export async function ensureSeeded() {
  await tx(async () => {
    await run('SELECT pg_advisory_xact_lock(4242)');
    if (await one('SELECT 1 FROM society WHERE id = 1')) return;
    await seed();
    console.log('Seeded demo society "Palm Grove Residency".');
  });
}

let ready: Promise<void> | null = null;
/** Run once per process before serving requests. */
export const bootstrap = () => (ready ??= (async () => { await loadSecret(); await ensureSeeded(); })().catch(err => { ready = null; throw err; }));
