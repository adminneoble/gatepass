import postgres from 'postgres';
import type { Driver } from './db.js';

/** postgres.js driver (Supabase). `prepare: false` keeps it compatible with the transaction pooler. */
export function pgDriver(url: string, max = 5): Driver {
  const sql = postgres(url, {
    prepare: false,
    max,
    idle_timeout: 20,
    // COUNT(*) and other int8 results come back as JS numbers, like SQLite did.
    types: { bigint: { to: 20, from: [20], parse: (x: string) => Number(x), serialize: (x: number) => String(x) } },
    onnotice: () => {},
  });
  const wrap = (s: postgres.Sql | postgres.TransactionSql): Driver => ({
    async query(text, params) {
      const r = await s.unsafe(text, params as postgres.ParameterOrJSON<never>[]);
      return { rows: [...r] as Record<string, unknown>[], count: r.count };
    },
    begin: fn => sql.begin(t => fn(wrap(t))) as Promise<never>,
    async exec(text) { await s.unsafe(text); },
    close: () => sql.end(),
  });
  return wrap(sql);
}
