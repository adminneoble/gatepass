import { PGlite, types, type Transaction } from '@electric-sql/pglite';
import type { Driver } from './db.js';

/** In-process Postgres for tests and offline dev. `dataDir` persists to disk; omit for in-memory. */
export async function pgliteDriver(dataDir?: string): Promise<Driver> {
  const db = await PGlite.create(dataDir, { parsers: { [types.INT8]: (x: string) => Number(x) } });
  const wrap = (s: PGlite | Transaction): Driver => ({
    async query(text, params) {
      const r = await s.query<Record<string, unknown>>(text, params);
      return { rows: r.rows, count: r.affectedRows ?? r.rows.length };
    },
    begin: fn => db.transaction(t => fn(wrap(t))),
    async exec(text) { await s.exec(text); },
    close: () => db.close(),
  });
  return wrap(db);
}
