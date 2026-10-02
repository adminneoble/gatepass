import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { config } from '../config.js';

export const db = new Database(config.dbFile);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

export function migrate() {
  db.exec(readFileSync(new URL('./schema.sql', import.meta.url), 'utf8'));
  upgrade();
}

/** In-place upgrades for databases created by earlier versions. Each step is idempotent. */
function upgrade() {
  const cols = (t: string) => (db.prepare(`PRAGMA table_info(${t})`).all() as { name: string }[]).map(c => c.name);
  if (!cols('passes').includes('revoked_at')) db.exec('ALTER TABLE passes ADD COLUMN revoked_at TEXT');
  for (const [c, t] of [['actor_id', 'INTEGER'], ['actor_name', 'TEXT'], ['actor_mobile', 'TEXT'], ['actor_role', 'TEXT'], ['data', 'TEXT']])
    if (!cols('events').includes(c)) db.exec(`ALTER TABLE events ADD COLUMN ${c} ${t}`);
  // Sessions now last until sign-out.
  db.exec("UPDATE sessions SET expires_at = '9999-12-31T23:59:59.000Z' WHERE expires_at < '9999'");
  if (!cols('passes').includes('time_slot')) db.exec('ALTER TABLE passes ADD COLUMN time_slot TEXT');

  // events.kind gained 'revoke'; SQLite can't alter a CHECK, so rebuild the table.
  const ev = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'events'").get() as { sql: string };
  if (!ev.sql.includes("'revoke'")) {
    db.transaction(() => {
      db.exec(`
        CREATE TABLE events_v2 (
          id      INTEGER PRIMARY KEY AUTOINCREMENT,
          day     TEXT NOT NULL,
          at      TEXT NOT NULL,
          unit_id TEXT NOT NULL,
          name    TEXT NOT NULL,
          kind    TEXT NOT NULL CHECK (kind IN ('request', 'approved', 'denied', 'entry', 'exit', 'pass', 'extend', 'tenant', 'profile', 'alert', 'revoke')),
          detail  TEXT NOT NULL DEFAULT ''
        );
        INSERT INTO events_v2 (id, day, at, unit_id, name, kind, detail) SELECT id, day, at, unit_id, name, kind, detail FROM events;
        DROP TABLE events;
        ALTER TABLE events_v2 RENAME TO events;
        CREATE INDEX IF NOT EXISTS events_day ON events(day);
        CREATE INDEX IF NOT EXISTS events_unit_day ON events(unit_id, day);
      `);
    })();
  }
}

/** Run fn in a transaction; nested calls join the outer one. */
export function tx<T>(fn: () => T): T {
  return db.inTransaction ? fn() : db.transaction(fn)();
}

export const one = <T>(sql: string, ...p: unknown[]) => db.prepare(sql).get(...p) as T | undefined;
export const all = <T>(sql: string, ...p: unknown[]) => db.prepare(sql).all(...p) as T[];
export const run = (sql: string, ...p: unknown[]) => db.prepare(sql).run(...p);
