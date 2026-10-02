import { all, insert, one, run } from './db/db.js';
import { localDay, nowIso } from './lib/time.js';
import { fmtMobile } from './lib/format.js';
import { invalidate, pushToPeople } from './lib/realtime.js';
import { notFound } from './lib/errors.js';

export type Person = { id: number; name: string; mobile: string };
export type UnitRow = { id: string; type: 'Flat' | 'Office'; owner_id: number; tenant_id: number | null; divert_to_tenant: number; cc_owner: number };
export type Society = {
  name: string; logo: string | null; gate_phone: string; supervisor_name: string; supervisor_phone: string;
  otp_required: number; auto_share_pass: number; pass_validity: '4 hours' | '24 hours' | '3 days';
};
export type Recipient = Person & { role: 'Owner' | 'Tenant' };
export type EventKind = 'request' | 'approved' | 'denied' | 'entry' | 'exit' | 'pass' | 'extend' | 'tenant' | 'profile' | 'alert' | 'revoke';

export const society = async () => (await one<Society>('SELECT * FROM society WHERE id = 1'))!;

export const personById = (id: number) => one<Person>('SELECT id, name, mobile FROM people WHERE id = ?', id);
export const personByMobile = (mobile: string) => one<Person>('SELECT id, name, mobile FROM people WHERE mobile = ?', mobile);

export async function unitRow(id: string) {
  const u = await one<UnitRow>('SELECT * FROM units WHERE id = ?', id);
  if (!u) throw notFound(`Unit ${id} is not in the directory.`);
  return u;
}

/** Find or create a person by mobile; updates the name if it changed. */
export async function upsertPerson(name: string, mobile: string): Promise<Person> {
  const ex = await personByMobile(mobile);
  if (ex) {
    if (ex.name !== name) await run('UPDATE people SET name = ? WHERE id = ?', name, ex.id);
    return { ...ex, name };
  }
  const id = await insert('INSERT INTO people (name, mobile, created_at) VALUES (?, ?, ?)', name, mobile, nowIso());
  return { id, name, mobile };
}

/**
 * Who gets a visitor request for a unit. Tenant (plus owner if cc'd) when the owner has
 * diverted requests to an existing tenant; otherwise the owner alone.
 */
export async function recipients(unitId: string): Promise<Recipient[]> {
  const u = await one<UnitRow>('SELECT * FROM units WHERE id = ?', unitId);
  if (!u) return [];
  const owner = { ...(await personById(u.owner_id))!, role: 'Owner' as const };
  if (u.tenant_id && u.divert_to_tenant) {
    const tenant = { ...(await personById(u.tenant_id))!, role: 'Tenant' as const };
    return u.cc_owner ? [tenant, owner] : [tenant];
  }
  return [owner];
}

export const recipientLabel = async (unitId: string) => (await recipients(unitId)).map(r => `${r.name} (${r.role})`).join(' and ');

/** Units a person owns or rents, in id order. */
export const unitsOf = (personId: number) =>
  all<UnitRow>('SELECT * FROM units WHERE owner_id = ? OR tenant_id = ? ORDER BY id', personId, personId);

/** True if the person is a current recipient for this unit's visitor requests. */
export const routesTo = async (unitId: string, personId: number) => (await recipients(unitId)).some(r => r.id === personId);

/** True if the person owns or rents the unit. */
export async function belongsTo(unitId: string, personId: number) {
  const u = await one<UnitRow>('SELECT * FROM units WHERE id = ?', unitId);
  return !!u && (u.owner_id === personId || u.tenant_id === personId);
}

export type Change = { field: string; from: string; to: string };
export type EventMeta = {
  actor?: Person; role?: 'Admin' | 'Security' | 'Resident';
  fields?: [string, string | null | undefined][];
  changes?: Change[];
};

/** Append to the audit log. `meta` records who did it and the full detail shown to admins. */
export async function logEvent(kind: EventKind, name: string, unitId: string, detail = '', meta: EventMeta = {}) {
  const now = new Date();
  const fields = (meta.fields ?? []).filter(([, v]) => v !== null && v !== undefined && v !== '') as [string, string][];
  const changes = (meta.changes ?? []).filter(c => c.from !== c.to);
  const data = fields.length || changes.length ? JSON.stringify({ fields, changes }) : null;
  await run(
    'INSERT INTO events (day, at, unit_id, name, kind, detail, actor_id, actor_name, actor_mobile, actor_role, data) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    localDay(now), now.toISOString(), unitId, name, kind, detail,
    meta.actor?.id ?? null, meta.actor?.name ?? null, meta.actor?.mobile ?? null, meta.role ?? null, data,
  );
  invalidate('events');
}

/** "Name · +91 98xxx xxxxx" or "—". */
export const personLabel = (p?: { name: string; mobile: string } | null) => (p ? `${p.name} · ${fmtMobile(p.mobile)}` : '—');
export const yesNo = (b: unknown) => (b ? 'Yes' : 'No');

/** Persist a notification (bell list) and push a live banner. */
export async function notify(personIds: number[], text: string, opts: { tone?: 'info' | 'alert'; link?: string } = {}) {
  const ids = [...new Set(personIds)];
  const at = nowIso();
  for (const id of ids) await run('INSERT INTO notifications (person_id, text, link, created_at) VALUES (?, ?, ?, ?)', id, text, opts.link ?? null, at);
  pushToPeople(ids, { text, ...opts });
  invalidate('notifications');
}

export const describePerson = (p: Person) => `${p.name} · ${fmtMobile(p.mobile)}`;
