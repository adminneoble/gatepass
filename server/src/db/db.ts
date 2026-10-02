import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * Minimal Postgres driver interface. Production uses postgres.js against Supabase (db/pg.ts);
 * tests and offline dev use in-process PGlite (db/pglite.ts).
 */
export type Rows = { rows: Record<string, unknown>[]; count: number };
export interface Driver {
  query(sql: string, params: unknown[]): Promise<Rows>;
  /** Run fn inside a transaction; the callback receives a driver bound to it. */
  begin<T>(fn: (tx: Driver) => Promise<T>): Promise<T>;
  /** Run a multi-statement script (schema). */
  exec(sql: string): Promise<void>;
  close(): Promise<void>;
}

let driver: Driver | null = null;
const current = new AsyncLocalStorage<Driver>();

export const setDriver = (d: Driver) => { driver = d; };
export const getDriver = () => {
  if (!driver) throw new Error('Database driver not initialised');
  return driver;
};
/** The transaction driver when inside tx(), otherwise the pool. */
const q = () => current.getStore() ?? getDriver();

/** SQLite-style `?` placeholders → Postgres `$n` (ignores `?` inside quoted strings). */
export function toPg(sql: string) {
  let n = 0, out = '', quote: string | null = null;
  for (const ch of sql) {
    if (quote) { if (ch === quote) quote = null; out += ch; continue; }
    if (ch === "'" || ch === '"') { quote = ch; out += ch; continue; }
    out += ch === '?' ? `$${++n}` : ch;
  }
  return out;
}

const exec = (sql: string, p: unknown[]) => q().query(toPg(sql), p.map(v => (v === undefined ? null : v)));

export const one = async <T>(sql: string, ...p: unknown[]) => (await exec(sql, p)).rows[0] as T | undefined;
export const all = async <T>(sql: string, ...p: unknown[]) => (await exec(sql, p)).rows as T[];
export const run = async (sql: string, ...p: unknown[]) => ({ changes: (await exec(sql, p)).count });
/** INSERT … RETURNING id. */
export const insert = async (sql: string, ...p: unknown[]) => Number((await exec(sql + ' RETURNING id', p)).rows[0].id);

/** Run fn in a transaction; nested calls join the outer one. */
export async function tx<T>(fn: () => Promise<T>): Promise<T> {
  if (current.getStore()) return fn();
  return getDriver().begin(t => current.run(t, fn));
}

/** Create tables if missing (local dev and tests; Supabase gets the same SQL as a migration). */
export async function migrate() {
  const { readFileSync } = await import('node:fs');
  await getDriver().exec(readFileSync(new URL('./schema.sql', import.meta.url), 'utf8'));
}
