import { config } from './config.js';
import { migrate, one } from './db/db.js';
import { seed } from './db/seed.js';
import { createApp } from './app.js';

migrate();
if (!one('SELECT 1 FROM society WHERE id = 1')) {
  seed();
  console.log('Seeded demo society "Palm Grove Residency".');
}
createApp().listen(config.port, () => console.log(`Gatepass API on http://localhost:${config.port}`));
