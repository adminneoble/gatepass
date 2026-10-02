import { config } from './config.js';
import { migrate, setDriver } from './db/db.js';
import { createApp } from './app.js';
import { bootstrap } from './bootstrap.js';
import { setPublisher } from './lib/realtime.js';

// Local Node server. With DATABASE_URL it talks to Supabase (including live updates);
// without it, an on-disk PGlite database in server/.pglite (no live updates).
if (config.databaseUrl) {
  const { pgDriver } = await import('./db/pg.js');
  const { realtimeSend } = await import('./lib/supabase.js');
  setDriver(pgDriver(config.databaseUrl));
  setPublisher(realtimeSend);
} else {
  const { pgliteDriver } = await import('./db/pglite.js');
  setDriver(await pgliteDriver(config.pgliteDir));
  await migrate();
}
if (!config.secret && !config.isProd) config.secret = 'dev-only-gatepass-secret';
await bootstrap();

createApp().listen(config.port, () => console.log(`Gatepass API on http://localhost:${config.port} (${config.databaseUrl ? 'Supabase' : 'PGlite'})`));
