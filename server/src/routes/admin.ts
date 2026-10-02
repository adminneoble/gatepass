import { Router } from 'express';
import { all, one, run, tx } from '../db/db.js';
import { requireRole, sessionToken, SESSION_NEVER } from '../auth.js';
import { logEvent, notify, personById, personByMobile, personLabel, recipientLabel, society, unitRow, upsertPerson, type Change, type Person, type UnitRow } from '../domain.js';
import { bad, conflict, notFound } from '../lib/errors.js';
import { invalidate, refreshPerson } from '../lib/realtime.js';
import { sendSms } from '../lib/sms.js';
import { localTime, nowIso } from '../lib/time.js';
import { fmtMobile } from '../lib/format.js';
import { sha256 } from '../lib/crypto.js';
import { mobile, name, parse, unitId, z } from '../lib/validate.js';
import { resetDemo } from '../db/reset.js';
import { idParam } from './gate.js';
import { config } from '../config.js';

export const admin = Router();
admin.use('/admin', requireRole('admin'));

/** Who receives visitor requests for a unit that has a tenant. */
const notifyField = z.enum(['Owner', 'Tenant', 'Both']);
type Notify = z.infer<typeof notifyField>;
const routing = (n: Notify) => ({ divert: n === 'Owner' ? 0 : 1, cc: n === 'Both' ? 1 : 0 });

const personOut = (p: Person | undefined | null) => (p ? { name: p.name, mobile: p.mobile } : null);

admin.get('/admin/units', async (_req, res) => {
  const units = await all<UnitRow>('SELECT * FROM units ORDER BY id');
  res.json(await Promise.all(units.map(async u => ({
    id: u.id, type: u.type,
    owner: personOut(await personById(u.owner_id)), tenant: personOut(u.tenant_id ? await personById(u.tenant_id) : null),
    divertToTenant: !!u.divert_to_tenant, ccOwner: !!u.cc_owner, goesTo: await recipientLabel(u.id),
  }))));
});

/** Unit state used to diff before/after for the audit log. */
async function snapshot(unitId: string) {
  const u = await one<UnitRow>('SELECT * FROM units WHERE id = ?', unitId);
  if (!u) return null;
  const owner = (await personById(u.owner_id))!, tenant = u.tenant_id ? (await personById(u.tenant_id))! : null;
  return { owner, tenant, goesTo: await recipientLabel(unitId) };
}
type Snap = Awaited<ReturnType<typeof snapshot>>;
function diff(before: Snap, after: Snap): Change[] {
  return [
    { field: 'Owner name', from: before?.owner.name ?? '—', to: after?.owner.name ?? '—' },
    { field: 'Owner mobile', from: before ? fmtMobile(before.owner.mobile) : '—', to: after ? fmtMobile(after.owner.mobile) : '—' },
    { field: 'Tenant', from: personLabel(before?.tenant), to: personLabel(after?.tenant) },
    { field: 'Visitor requests go to', from: before?.goesTo ?? '—', to: after?.goesTo ?? '—' },
  ];
}
const asAdmin = (req: { user?: Person }) => ({ actor: req.user!, role: 'Admin' as const });

async function welcome(p: Person, unit: string, role: string) {
  await sendSms(p.mobile, `${(await society()).name}: You've been added as ${role.toLowerCase()} of ${unit}. Sign in to Gatepass with this number:`, config.publicUrl + '/login');
}

/** Add an owner to a new unit, or replace the owner/tenant of an existing one. */
admin.post('/admin/members', async (req, res) => {
  const b = parse(z.object({ unitId, type: z.enum(['Flat', 'Office']).default('Flat'), role: z.enum(['Owner', 'Tenant']).default('Owner'), name, mobile, notify: notifyField.default('Tenant') }), req.body);
  const ex = await one<UnitRow>('SELECT * FROM units WHERE id = ?', b.unitId);
  const role = ex ? b.role : 'Owner';
  const before = await snapshot(b.unitId);
  const p = await tx(async () => {
    const p = await upsertPerson(b.name, b.mobile);
    if (!ex) await run('INSERT INTO units (id, type, owner_id) VALUES (?, ?, ?)', b.unitId, b.type, p.id);
    else if (role === 'Owner') {
      if (ex.tenant_id === p.id) throw bad(`${p.name} is the tenant of ${ex.id}. Remove them as tenant first.`);
      await run('UPDATE units SET owner_id = ? WHERE id = ?', p.id, ex.id);
    } else {
      if (ex.owner_id === p.id) throw bad(`${p.name} is the owner of ${ex.id}.`);
      const n = routing(b.notify);
      await run('UPDATE units SET tenant_id = ?, divert_to_tenant = ?, cc_owner = ? WHERE id = ?', p.id, n.divert, n.cc, ex.id);
    }
    return p;
  });
  await logEvent('tenant', p.name, b.unitId, `${role} added by admin`, {
    ...asAdmin(req),
    fields: [['Action', ex ? `${role} added to existing ${ex.type.toLowerCase()}` : `New ${b.type.toLowerCase()} created`], ['Role', role], ['Name', p.name], ['Mobile', fmtMobile(p.mobile)], ['Welcome SMS', 'Sent']],
    changes: diff(before, await snapshot(b.unitId)),
  });
  await welcome(p, b.unitId, role);
  if (ex) { refreshPerson(ex.owner_id); if (ex.tenant_id) refreshPerson(ex.tenant_id); }
  invalidate('units');
  res.status(201).json({ message: `${p.name} added as ${role.toLowerCase()} of ${b.unitId}` });
});

/** Change a person's details everywhere. Fails if the new number belongs to someone else. */
async function editPerson(id: number, next: { name: string; mobile: string }) {
  const cur = (await personById(id))!;
  if (cur.mobile !== next.mobile) {
    const other = await personByMobile(next.mobile);
    if (other && other.id !== id) throw conflict(`${fmtMobile(next.mobile)} is already registered to ${other.name}.`);
  }
  if (cur.name !== next.name || cur.mobile !== next.mobile) {
    await run('UPDATE people SET name = ?, mobile = ? WHERE id = ?', next.name, next.mobile, id);
    refreshPerson(id);
  }
}

admin.patch('/admin/units/:id', async (req, res) => {
  const u = await unitRow(String(req.params.id).toUpperCase());
  const b = parse(z.object({
    owner: z.object({ name, mobile }),
    tenant: z.object({ name, mobile }).nullable(),
    notify: notifyField.optional(),
  }), req.body);
  const before = await snapshot(u.id);
  let welcomed: Person | null = null;
  await tx(async () => {
    await editPerson(u.owner_id, b.owner);
    if (!b.tenant && u.tenant_id) {
      await run('UPDATE units SET tenant_id = NULL, divert_to_tenant = 0, cc_owner = 0 WHERE id = ?', u.id);
      refreshPerson(u.tenant_id);
    } else if (b.tenant && u.tenant_id) await editPerson(u.tenant_id, b.tenant);
    else if (b.tenant && !u.tenant_id) {
      const t = await upsertPerson(b.tenant.name, b.tenant.mobile);
      if (t.id === u.owner_id) throw bad('The tenant cannot be the owner.');
      await run('UPDATE units SET tenant_id = ?, divert_to_tenant = 1, cc_owner = 0 WHERE id = ?', t.id, u.id);
      welcomed = t;
    }
    if (b.tenant && b.notify) {
      const n = routing(b.notify);
      await run('UPDATE units SET divert_to_tenant = ?, cc_owner = ? WHERE id = ?', n.divert, n.cc, u.id);
    }
  });
  if (welcomed) await welcome(welcomed, u.id, 'Tenant');
  const changes = diff(before, await snapshot(u.id)).filter(c => c.from !== c.to);
  if (changes.length) await logEvent('tenant', b.owner.name, u.id, 'Details updated by admin', { ...asAdmin(req), fields: [['Action', 'Unit details edited']], changes });
  invalidate('units');
  res.json({ message: `${u.id} updated` });
});

admin.get('/admin/tenant-requests', async (_req, res) => {
  const rows = await all<{ id: number; unit_id: string; kind: string; name: string; mobile: string; created_at: string; requested_by_name: string }>(`
    SELECT r.id, r.unit_id, r.kind, r.name, r.mobile, r.created_at, p.name AS requested_by_name FROM tenant_requests r
    JOIN people p ON p.id = r.requested_by WHERE r.status = 'pending' ORDER BY r.id`);
  res.json(rows.map(r => ({ id: r.id, unitId: r.unit_id, kind: r.kind, name: r.name, mobile: r.mobile, requestedBy: r.requested_by_name, time: localTime(r.created_at) })));
});

admin.post('/admin/tenant-requests/:id/:action', async (req, res) => {
  const action = parse(z.enum(['approve', 'reject']), req.params.action);
  const { notify: sendTo } = parse(z.object({ notify: notifyField.default('Tenant') }), req.body ?? {});
  const r = await one<{ id: number; unit_id: string; kind: 'add' | 'remove'; name: string; mobile: string; requested_by: number; status: string }>('SELECT * FROM tenant_requests WHERE id = ?', idParam(req.params.id));
  if (!r) throw notFound('Request not found.');
  if (r.status !== 'pending') throw conflict('This request was already handled.');
  const u = await unitRow(r.unit_id);
  const before = await snapshot(u.id);
  const requester = await personById(r.requested_by);
  let welcomed: Person | null = null;
  const message = await tx(async () => {
    await run('UPDATE tenant_requests SET status = ?, resolved_at = ? WHERE id = ?', action === 'approve' ? 'approved' : 'rejected', nowIso(), r.id);
    if (action === 'reject') {
      await logEvent('tenant', r.name, r.unit_id, `Tenant ${r.kind === 'add' ? 'addition' : 'removal'} request rejected`, {
        ...asAdmin(req), fields: [['Request', r.kind === 'add' ? 'Add tenant' : 'Remove tenant'], ['Tenant', personLabel(r)], ['Requested by', personLabel(requester)], ['Decision', 'Rejected']],
      });
      return `Admin declined the tenant request for ${r.unit_id}.`;
    }
    let message: string;
    if (r.kind === 'add') {
      if (u.tenant_id) throw conflict(`${u.id} already has a tenant.`);
      const t = await upsertPerson(r.name, r.mobile);
      if (t.id === u.owner_id) throw bad('The tenant cannot be the owner.');
      const n = routing(sendTo);
      await run('UPDATE units SET tenant_id = ?, divert_to_tenant = ?, cc_owner = ? WHERE id = ?', t.id, n.divert, n.cc, u.id);
      welcomed = t;
      message = `Admin added ${r.name} as tenant of ${r.unit_id}. They can sign in to Gatepass with ${fmtMobile(r.mobile)}.`;
    } else {
      await run('UPDATE units SET tenant_id = NULL, divert_to_tenant = 0, cc_owner = 0 WHERE id = ?', u.id);
      if (u.tenant_id) refreshPerson(u.tenant_id);
      message = `Admin removed ${r.name} as tenant of ${r.unit_id}.`;
    }
    await logEvent('tenant', r.name, r.unit_id, r.kind === 'add' ? 'Tenant added by admin' : 'Tenant removed by admin', {
      ...asAdmin(req),
      fields: [['Request', r.kind === 'add' ? 'Add tenant' : 'Remove tenant'], ['Tenant', personLabel(r)], ['Requested by', personLabel(requester)], ['Decision', 'Approved']],
      changes: diff(before, await snapshot(u.id)),
    });
    return message;
  });
  if (welcomed) await welcome(welcomed, u.id, 'Tenant');
  await notify([r.requested_by], message, { link: '/app/units' });
  invalidate('requests', 'units');
  res.json({ ok: true });
});

/**
 * Demo prototype only: wipe all data and restore the demo society. Everyone else is signed out;
 * the admin who pressed it stays signed in if their number is part of the demo data.
 */
admin.post('/admin/demo/reset', async (req, res) => {
  if (!config.demo) throw notFound();
  const me = req.user!, token = sessionToken(req);
  await resetDemo();
  const again = await personByMobile(me.mobile);
  if (again && token) await run('INSERT INTO sessions (token_hash, person_id, created_at, expires_at) VALUES (?, ?, ?, ?)', sha256(token), again.id, nowIso(), SESSION_NEVER);
  invalidate('visits', 'passes', 'alerts', 'units', 'requests', 'society', 'events', 'notifications', 'me', 'sms', 'notices');
  res.json({ message: 'Demo data restored.', signedOut: !again });
});
