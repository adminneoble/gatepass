import { all, run, tx } from './db.js';
import { seed } from './seed.js';

/** Wipe every table and re-seed the demo society. Keeps app_settings (the signing secret). */
export async function resetDemo() {
  await tx(async () => {
    const tables = (await all<{ tablename: string }>(
      "SELECT tablename FROM pg_tables WHERE schemaname = current_schema() AND tablename <> 'app_settings'")).map(t => `"${t.tablename}"`);
    await run(`TRUNCATE ${tables.join(', ')} RESTART IDENTITY CASCADE`);
    await seed();
  });
}
