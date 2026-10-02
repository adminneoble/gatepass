// `npm run db:reset`: wipe and re-seed the database the server is configured for.
import { config } from '../config.js';
import { migrate, setDriver } from './db.js';
import { resetDemo } from './reset.js';
import { loadSecret } from '../bootstrap.js';

if (config.databaseUrl) {
  const { pgDriver } = await import('./pg.js');
  setDriver(pgDriver(config.databaseUrl));
} else {
  const { pgliteDriver } = await import('./pglite.js');
  setDriver(await pgliteDriver(config.pgliteDir));
  await migrate();
}
if (!config.secret && !config.databaseUrl) config.secret = 'dev-only-gatepass-secret';
await loadSecret();
await resetDemo();
console.log(`Reset ${config.databaseUrl ? 'the Supabase database' : config.pgliteDir} with demo data.`);
process.exit(0);
