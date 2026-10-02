import { Router } from 'express';
import { all, one, run, tx } from '../db/db.js';
import { requireRole } from '../auth.js';
import { logEvent, notify, personById, personByMobile, personLabel, recipientLabel, society, unitRow, upsertPerson, type Change, type Person, type UnitRow } from '../domain.js';
import { bad, conflict, notFound } from '../lib/errors.js';
import { invalidate, refreshPerson } from '../lib/realtime.js';
import { sendSms } from '../lib/sms.js';
import { localTime, nowIso } from '../lib/time.js';
import { fmtMobile } from '../lib/format.js';
import { mobile, name, parse, unitId, z } from '../lib/validate.js';
import { config } from '../config.js';

export const admin = Router();
admin.use('/admin', requireRole('admin'));

/** Who receives visitor requests for a unit that has a tenant. */
const notifyField = z.enum(['Owner', 'Tenant', 'Both']);
type Notify = z.infer<typeof notifyField>;
const routing = (n: Notify) => ({ divert: n === 'Owner' ? 0 : 1, cc: n === 'Both' ? 1 : 0 });

const personOut = (p: Person | undefined | null) => (p ? { name: p.name, mobile: p.mobile } : null);

admin.get('/admin/units', (_req, res) => {
  const units = all<UnitRow>('SELECT * FROM units ORDER BY id');
  res.json(units.map(u => ({
    id: u.id, type: u.type,
    owner: personOut(personById(u.owner_id)), tenant: personOut(u.tenant_id ? personById(u.tenant_id) : null),
    divertToTenant: !!u.divert_to_tenant, ccOwner: !!u.cc_owner, goesTo: recipientLabel(u.id),
  })));
});

/** Unit state used to diff before/after for the audit log. */
function snapshot(unitId: string) {
  const u = one<UnitRow>('SELECT * FROM units WHERE id = ?', unitId);
  if (!u) return null;
  const owner = personById(u.owner_id)!, tenant = u.tenant_id ? personById(u.tenant_id)! : null;
  return { owner, tenant, goesTo: recipientLabel(unitId) };
}
type Snap = ReturnType<typeof snapshot>;
function diff(before: Snap, after: Snap): Change[] {
  return [
    { field: 'Owner name', from: before?.owner.name ?? '—', to: after?.owner.name ?? '—' },
    { field: 'Owner mobile', from: before ? fmtMobile(before.owner.mobile) : '—', to: after ? fmtMobile(after.owner.mobile) : '—' },
    { field: 'Tenant', from: personLabel(before?.tenant), to: personLabel(after?.tenant) },
    { field: 'Visitor requests go to', from: before?.goesTo ?? '—', to: after?.goesTo ?? '—' },
  ];
}
const asAdmin = (req: { user?: Person }) => ({ actor: req.user!, role: 'Admin' as const });

function welcome(p: Person, unit: string, role: string) {
  sendSms(p.mobile, `${society().name}: You've been added as ${role.toLowerCase()} of ${unit}. Sign in to Gatepass with this number:`, config.publicUrl + '/login');
}

/** Add an owner to a new unit, or replace the owner/tenant of an existing one. */
admin.post('/admin/members', (req, res) => {
  const b = parse(z.object({ unitId, type: z.enum(['Flat', 'Office']).default('Flat'), role: z.enum(['Owner', 'Tenant']).default('Owner'), name, mobile, notify: notifyField.default('Tenant') }), req.body);
  const ex = one<UnitRow>('SELECT * FROM units WHERE id = ?', b.unitId);
  const role = ex ? b.role : 'Owner';
  const before = snapshot(b.unitId);
  const p = tx(() => {
    const p = upsertPerson(b.name, b.mobile);
    if (!ex) run('INSERT INTO units (id, type, owner_id) VALUES (?, ?, ?)', b.unitId, b.type, p.id);
    else if (role === 'Owner') {
      if (ex.tenant_id === p.id) throw bad(`${p.name} is the tenant of ${ex.id}. Remove them as tenant first.`);
      run('UPDATE units SET owner_id = ? WHERE id = ?', p.id, ex.id);
    } else {
      if (ex.owner_id === p.id) throw bad(`${p.name} is the owner of ${ex.id}.`);
      const n = routing(b.notify);
      run('UPDATE units SET tenant_id = ?, divert_to_tenant = ?, cc_owner = ? WHERE id = ?', p.id, n.divert, n.cc, ex.id);
    }
    return p;
  });
  logEvent('tenant', p.name, b.unitId, `${role} added by admin`, {
    ...asAdmin(req),
    fields: [['Action', ex ? `${role} added to existing ${ex.type.toLowerCase()}` : `New ${b.type.toLowerCase()} created`], ['Role', role], ['Name', p.name], ['Mobile', fmtMobile(p.mobile)], ['Welcome SMS', 'Sent']],
    changes: diff(before, snapshot(b.unitId)),
  });
  welcome(p, b.unitId, role);
  if (ex) { refreshPerson(ex.owner_id); if (ex.tenant_id) refreshPerson(ex.tenant_id); }
  invalidate('units');
  res.status(201).json({ message: `${p.name} added as ${role.toLowerCase()} of ${b.unitId}` });
});

/** Change a person's details everywhere. Fails if the new number belongs to someone else. */
function editPerson(id: number, next: { name: string; mobile: string }) {
  const cur = personById(id)!;
  if (cur.mobile !== next.mobile) {
    const other = personByMobile(next.mobile);
    if (other && other.id !== id) throw conflict(`${fmtMobile(next.mobile)} is already registered to ${other.name}.`);
  }
  if (cur.name !== next.name || cur.mobile !== next.mobile) {
    run('UPDATE people SET name = ?, mobile = ? WHERE id = ?', next.name, next.mobile, id);
    refreshPerson(id);
  }
}

admin.patch('/admin/units/:id', (req, res) => {
  const u = unitRow(String(req.params.id).toUpperCase());
  const b = parse(z.object({
    owner: z.object({ name, mobile }),
    tenant: z.object({ name, mobile }).nullable(),
    notify: notifyField.optional(),
  }), req.body);
  const before = snapshot(u.id);
  tx(() => {
    editPerson(u.owner_id, b.owner);
    if (!b.tenant && u.tenant_id) {
      run('UPDATE units SET tenant_id = NULL, divert_to_tenant = 0, cc_owner = 0 WHERE id = ?', u.id);
      refreshPerson(u.tenant_id);
    } else if (b.tenant && u.tenant_id) editPerson(u.tenant_id, b.tenant);
    else if (b.tenant && !u.tenant_id) {
      const t = upsertPerson(b.tenant.name, b.tenant.mobile);
      if (t.id === u.owner_id) throw bad('The tenant cannot be the owner.');
      run('UPDATE units SET tenant_id = ?, divert_to_tenant = 1, cc_owner = 0 WHERE id = ?', t.id, u.id);
      welcome(t, u.id, 'Tenant');
    }
    if (b.tenant && b.notify) {
      const n = routing(b.notify);
      run('UPDATE units SET divert_to_tenant = ?, cc_owner = ? WHERE id = ?', n.divert, n.cc, u.id);
    }
  });
  const changes = diff(before, snapshot(u.id)).filter(c => c.from !== c.to);
  if (changes.length) logEvent('tenant', b.owner.name, u.id, 'Details updated by admin', { ...asAdmin(req), fields: [['Action', 'Unit details edited']], changes });
  invalidate('units');
  res.json({ message: `${u.id} updated` });
});

admin.get('/admin/tenant-requests', (_req, res) => {
  const rows = all<{ id: number; unit_id: string; kind: string; name: string; mobile: string; created_at: string; by: string }>(`
    SELECT r.id, r.unit_id, r.kind, r.name, r.mobile, r.created_at, p.name by FROM tenant_requests r
    JOIN people p ON p.id = r.requested_by WHERE r.status = 'pending' ORDER BY r.id`);
  res.json(rows.map(r => ({ id: r.id, unitId: r.unit_id, kind: r.kind, name: r.name, mobile: r.mobile, requestedBy: r.by, time: localTime(r.created_at) })));
});

admin.post('/admin/tenant-requests/:id/:action', (req, res) => {
  const action = parse(z.enum(['approve', 'reject']), req.params.action);
  const { notify: sendTo } = parse(z.object({ notify: notifyField.default('Tenant') }), req.body ?? {});
  const r = one<{ id: number; unit_id: string; kind: 'add' | 'remove'; name: string; mobile: string; requested_by: number; status: string }>('SELECT * FROM tenant_requests WHERE id = ?', Number(req.params.id));
  if (!r) throw notFound('Request not found.');
  if (r.status !== 'pending') throw conflict('This request was already handled.');
  const u = unitRow(r.unit_id);
  const before = snapshot(u.id);
  const requester = personById(r.requested_by);
  let message: string;
  tx(() => {
    run('UPDATE tenant_requests SET status = ?, resolved_at = ? WHERE id = ?', action === 'approve' ? 'approved' : 'rejected', nowIso(), r.id);
    if (action === 'reject') {
      message = `Admin declined the tenant request for ${r.unit_id}.`;
      logEvent('tenant', r.name, r.unit_id, `Tenant ${r.kind === 'add' ? 'addition' : 'removal'} request rejected`, {
        ...asAdmin(req), fields: [['Request', r.kind === 'add' ? 'Add tenant' : 'Remove tenant'], ['Tenant', personLabel(r)], ['Requested by', personLabel(requester)], ['Decision', 'Rejected']],
      });
      return;
    }
    if (r.kind === 'add') {
      if (u.tenant_id) throw conflict(`${u.id} already has a tenant.`);
      const t = upsertPerson(r.name, r.mobile);
      if (t.id === u.owner_id) throw bad('The tenant cannot be the owner.');
      const n = routing(sendTo);
      run('UPDATE units SET tenant_id = ?, divert_to_tenant = ?, cc_owner = ? WHERE id = ?', t.id, n.divert, n.cc, u.id);
      welcome(t, u.id, 'Tenant');
      message = `Admin added ${r.name} as tenant of ${r.unit_id}. They can sign in to Gatepass with ${fmtMobile(r.mobile)}.`;
    } else {
      run('UPDATE units SET tenant_id = NULL, divert_to_tenant = 0, cc_owner = 0 WHERE id = ?', u.id);
      if (u.tenant_id) refreshPerson(u.tenant_id);
      message = `Admin removed ${r.name} as tenant of ${r.unit_id}.`;
    }
    logEvent('tenant', r.name, r.unit_id, r.kind === 'add' ? 'Tenant added by admin' : 'Tenant removed by admin', {
      ...asAdmin(req),
      fields: [['Request', r.kind === 'add' ? 'Add tenant' : 'Remove tenant'], ['Tenant', personLabel(r)], ['Requested by', personLabel(requester)], ['Decision', 'Approved']],
      changes: diff(before, snapshot(u.id)),
    });
  });
  notify([r.requested_by], message!, { link: '/app/units' });
  invalidate('requests', 'units');
  res.json({ ok: true });
});
