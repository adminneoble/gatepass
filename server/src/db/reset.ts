import { rmSync } from 'node:fs';
import { config } from '../config.js';

for (const f of [config.dbFile, config.dbFile + '-wal', config.dbFile + '-shm']) rmSync(f, { force: true });
const { migrate } = await import('./db.js');
const { seed } = await import('./seed.js');
migrate();
seed();
console.log(`Reset ${config.dbFile} with demo data.`);
