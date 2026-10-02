import { Router } from 'express';
import { all, one, run, tx } from '../db/db.js';
import { checkOtp, issueOtp, requireRole } from '../auth.js';
import {
  belongsTo, logEvent, notify, personById, personByMobile, recipientLabel, routesTo, society, unitRow, unitsOf,
} from '../domain.js';
import { bad, conflict, forbidden, notFound } from '../lib/errors.js';
import { invalidate, pushToRole, refreshPerson } from '../lib/realtime.js';
import { sendSms } from '../lib/sms.js';
import { VALIDITY_MS, addDays, dayLabel, endOfDay, fullStamp, localDay, localTime, nowIso, startOfDay } from '../lib/time.js';
import { randomDigits } from '../lib/crypto.js';
import { ALERT_TYPES, PURPOSES, fmtMobile } from '../lib/format.js';
import { day, mobile, name, parse, unitId, z } from '../lib/validate.js';
import { passState, passView, relDay, visitView, type PassRow, type VisitRow } from '../views.js';
import { smsDecision } from './gate.js';
import { config } from '../config.js';

export const member = Router();
const auth = requireRole('member');

function myUnit(id: string, personId: number) {
  const u = unitRow(id);
  if (!belongsTo(u.id, personId)) throw forbidden('This unit is not linked to your number.');
  return u;
}

// ── Units ────────────────────────────────────────────────────────────────────

member.get('/me/units', auth, (req, res) => {
  const me = req.user!.id;
  const pending = (unit: string, kind: string) =>
    one<{ id: number; name: string; mobile: string }>("SELECT id, name, mobile FROM tenant_requests WHERE unit_id = ? AND kind = ? AND status = 'pending'", unit, kind);
  res.json(unitsOf(me).map(u => {
    const owner = personById(u.owner_id)!, tenant = u.tenant_id ? personById(u.tenant_id)! : null;
    return {
      id: u.id, type: u.type, isOwner: u.owner_id === me,
      owner: { name: owner.name, mobile: owner.mobile, isMe: owner.id === me },
      tenant: tenant && { name: tenant.name, mobile: tenant.mobile, isMe: tenant.id === me },
      divertToTenant: !!u.divert_to_tenant, ccOwner: !!u.cc_owner,
      goesTo: recipientLabel(u.id),
      pendingAdd: pending(u.id, 'add') ?? null,
      pendingRemove: pending(u.id, 'remove') ?? null,
    };
  }));
});

member.patch('/me/units/:id/routing', auth, (req, res) => {
  const u = myUnit(req.params.id as string, req.user!.id);
  if (u.owner_id !== req.user!.id) throw forbidden('Only the owner can change where requests go.');
  const b = parse(z.object({ divertToTenant: z.boolean().optional(), ccOwner: z.boolean().optional() }), req.body);
  if (!u.tenant_id && b.divertToTenant) throw bad('There is no tenant on this unit.');
  const divert = b.divertToTenant ?? !!u.divert_to_tenant;
  const was = recipientLabel(u.id);
  run('UPDATE units SET divert_to_tenant = ?, cc_owner = ? WHERE id = ?', +divert, divert ? +(b.ccOwner ?? !!u.cc_owner) : 0, u.id);
  logEvent('tenant', req.user!.name, u.id, 'Request routing changed by owner', {
    actor: req.user, role: 'Resident', changes: [{ field: 'Visitor requests go to', from: was, to: recipientLabel(u.id) }],
  });
  invalidate('units');
  res.json({ ok: true });
});

member.post('/me/units/:id/tenant-requests', auth, (req, res) => {
  const u = myUnit(req.params.id as string, req.user!.id);
  if (u.owner_id !== req.user!.id) throw forbidden('Only the owner can request tenant changes.');
  const b = parse(z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('add'), name, mobile }),
    z.object({ kind: z.literal('remove') }),
  ]), req.body);
  if (one("SELECT 1 FROM tenant_requests WHERE unit_id = ? AND kind = ? AND status = 'pending'", u.id, b.kind)) throw conflict('A request is already waiting for the admin.');
  let who: { name: string; mobile: string };
  if (b.kind === 'add') {
    if (u.tenant_id) throw conflict('This unit already has a tenant. Request removal first.');
    if (b.mobile === req.user!.mobile) throw bad('Enter the tenant\'s number, not yours.');
    who = { name: b.name, mobile: b.mobile };
  } else {
    if (!u.tenant_id) throw bad('There is no tenant to remove.');
    who = personById(u.tenant_id)!;
  }
  run('INSERT INTO tenant_requests (unit_id, kind, name, mobile, requested_by, created_at) VALUES (?, ?, ?, ?, ?, ?)', u.id, b.kind, who.name, who.mobile, req.user!.id, nowIso());
  logEvent('tenant', who.name, u.id, `Owner requested tenant ${b.kind === 'add' ? 'addition' : 'removal'}`, {
    actor: req.user, role: 'Resident', fields: [['Request', b.kind === 'add' ? 'Add tenant' : 'Remove tenant'], ['Tenant', `${who.name} · ${fmtMobile(who.mobile)}`], ['Status', 'Waiting for admin']],
  });
  pushToRole('admin', { text: `${req.user!.name} asked to ${b.kind} ${who.name} ${b.kind === 'add' ? 'as tenant of' : 'from'} ${u.id}.`, link: '/admin/directory' });
  invalidate('requests', 'units');
  res.status(201).json({ ok: true });
});

member.delete('/me/tenant-requests/:id', auth, (req, res) => {
  const r = one<{ id: number; requested_by: number; status: string; unit_id: string; kind: string; name: string; mobile: string }>('SELECT * FROM tenant_requests WHERE id = ?', Number(req.params.id));
  if (!r || r.requested_by !== req.user!.id) throw notFound('Request not found.');
  if (r.status !== 'pending') throw conflict('The admin has already handled this request.');
  run("UPDATE tenant_requests SET status = 'cancelled', resolved_at = ? WHERE id = ?", nowIso(), r.id);
  logEvent('tenant', r.name, r.unit_id, 'Owner cancelled tenant request', {
    actor: req.user, role: 'Resident', fields: [['Request', r.kind === 'add' ? 'Add tenant' : 'Remove tenant'], ['Tenant', `${r.name} · ${fmtMobile(r.mobile)}`]],
  });
  invalidate('requests', 'units');
  res.json({ ok: true });
});

// ── Profile ─────────────────────────────────────────────────────────────────

member.patch('/me/profile', requireRole(), (req, res) => {
  const me = req.user!;
  const b = parse(z.object({ name, mobile, code: z.string().regex(/^\d{4}$/).optional(), unitId: z.string().optional() }), req.body);
  const changed = b.mobile !== me.mobile;
  if (changed) {
    if (personByMobile(b.mobile)) throw conflict('This number is already registered to another member.');
    if (!b.code) {
      const code = issueOtp(b.mobile, 'mobile_change', c => `${c} is your Gatepass verification code.`);
      return res.json({ otpSent: true, ...(config.isProd ? {} : { devCode: code }) });
    }
    checkOtp(b.mobile, 'mobile_change', b.code);
  }
  run('UPDATE people SET name = ?, mobile = ? WHERE id = ?', b.name, b.mobile, me.id);
  const unit = b.unitId && belongsTo(b.unitId, me.id) ? b.unitId : unitsOf(me.id)[0]?.id;
  if (unit) logEvent('profile', b.name, unit, changed ? 'Mobile number updated' : 'Name updated', {
    actor: me, role: 'Resident',
    fields: [['Verified by OTP', changed ? 'Yes, sent to the new number' : 'Not needed'], ['Applies to units', unitsOf(me.id).map(u => u.id).join(', ')]],
    changes: [{ field: 'Name', from: me.name, to: b.name }, { field: 'Mobile', from: fmtMobile(me.mobile), to: fmtMobile(b.mobile) }],
  });
  refreshPerson(me.id);
  invalidate('units');
  res.json({ ok: true, message: changed ? `Mobile number updated to ${fmtMobile(b.mobile)}.` : 'Profile updated.' });
});

// ── Notifications ───────────────────────────────────────────────────────────

member.get('/me/notifications', requireRole(), (req, res) => {
  const rows = all<{ id: number; text: string; link: string | null; created_at: string; read_at: string | null }>(
    'SELECT * FROM notifications WHERE person_id = ? ORDER BY id DESC LIMIT 50', req.user!.id);
  res.json({
    unread: rows.filter(r => !r.read_at).length,
    items: rows.map(r => ({ id: r.id, text: r.text, link: r.link, read: !!r.read_at, day: localDay(new Date(r.created_at)), time: localTime(r.created_at) })),
  });
});

member.post('/me/notifications/read', requireRole(), (req, res) => {
  run('UPDATE notifications SET read_at = ? WHERE person_id = ? AND read_at IS NULL', nowIso(), req.user!.id);
  invalidate('notifications');
  res.json({ ok: true });
});

// ── Visitor requests ────────────────────────────────────────────────────────

/** Pending walk-ins across every unit that currently routes to me. */
member.get('/me/requests', auth, (req, res) => {
  const me = req.user!.id;
  const rows = all<VisitRow>("SELECT * FROM visits WHERE status = 'pending' ORDER BY id DESC");
  res.json(rows.filter(v => routesTo(v.unit_id, me)).map(visitView));
});

member.post('/visits/:id/decision', auth, (req, res) => {
  const { decision } = parse(z.object({ decision: z.enum(['approved', 'denied']) }), req.body);
  const v = one<VisitRow>('SELECT * FROM visits WHERE id = ?', Number(req.params.id));
  if (!v) throw notFound('Visit not found.');
  if (!routesTo(v.unit_id, req.user!.id)) throw forbidden('Requests for this unit go to someone else.');
  if (v.status !== 'pending') throw conflict(`Already ${v.status === 'denied' ? 'denied' : 'approved'} by another resident.`);
  run('UPDATE visits SET status = ?, decided_by = ?, decided_at = ? WHERE id = ?', decision, req.user!.id, nowIso(), v.id);
  logEvent(decision, v.name, v.unit_id, '', {
    actor: req.user, role: 'Resident',
    fields: [['Visitor mobile', fmtMobile(v.mobile)], ['Purpose', v.purpose], ['Arrived at gate', localTime(v.created_at)], ['Visitor told by SMS', 'Yes']],
  });
  smsDecision(v, decision === 'approved');
  pushToRole('security', { text: `${v.name} ${decision} by ${v.unit_id}`, tone: decision === 'approved' ? 'info' : 'alert' });
  invalidate('visits');
  res.json({ ok: true });
});

/** Today's closed/active visits at one of my units. */
member.get('/me/units/:id/visits', auth, (req, res) => {
  const u = myUnit(req.params.id as string, req.user!.id);
  const rows = all<VisitRow>("SELECT * FROM visits WHERE unit_id = ? AND status != 'pending' AND (day = ? OR status = 'inside') ORDER BY id DESC", u.id, localDay());
  res.json(rows.map(visitView));
});

// ── Passes ──────────────────────────────────────────────────────────────────

/** 6-digit code not used by any live pass. */
function freshCode() {
  for (let i = 0; i < 50; i++) {
    const c = randomDigits(6);
    if (!one('SELECT 1 FROM passes WHERE code = ? AND valid_until > ? AND revoked_at IS NULL', c, nowIso())) return c;
  }
  throw new Error('Could not allocate a pass code');
}

function smsPass(p: PassRow, text: string) {
  sendSms(p.mobile, text, passView(p).url);
  run('UPDATE passes SET sent = 1 WHERE id = ?', p.id);
}

member.get('/me/units/:id/passes', auth, (req, res) => {
  const u = myUnit(req.params.id as string, req.user!.id);
  const since = new Date(Date.now() - 30 * 864e5).toISOString();
  res.json(all<PassRow>('SELECT * FROM passes WHERE unit_id = ? AND (valid_until > ? OR created_at > ?) ORDER BY id DESC LIMIT 40', u.id, nowIso(), since).map(passView));
});

member.post('/passes', auth, (req, res) => {
  const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use a HH:MM time.');
  const b = parse(z.object({
    unitId, name, mobile, purpose: z.enum(PURPOSES),
    date: z.union([z.enum(['Today', 'Tomorrow']), day]),
    slotFrom: hhmm.optional(), slotTo: hhmm.optional(),
  }), req.body);
  myUnit(b.unitId, req.user!.id);
  const s = society();
  const today = localDay();
  const d = b.date === 'Today' ? today : b.date === 'Tomorrow' ? addDays(today, 1) : b.date;
  if (d < today || d > addDays(today, 3)) throw bad('Pick a date within the next 3 days.');
  if (!!b.slotFrom !== !!b.slotTo) throw bad('Choose both a start and an end time, or leave the slot empty.');

  // With a slot the pass is valid only inside it; otherwise for the society's validity from the start of the day (or now).
  const at = (t: string) => { const [h, m] = t.split(':').map(Number); return new Date(startOfDay(d).getTime() + (h * 60 + m) * 60e3); };
  let from: Date, until: Date, slot: string | null = null;
  if (b.slotFrom && b.slotTo) {
    if (b.slotTo <= b.slotFrom) throw bad('The end time must be after the start time.');
    from = at(b.slotFrom); until = at(b.slotTo);
    if (until.getTime() <= Date.now()) throw bad('That time slot has already passed.');
    slot = `${b.slotFrom}–${b.slotTo}`;
  } else {
    from = d === today ? new Date() : startOfDay(d);
    until = new Date(from.getTime() + VALIDITY_MS[s.pass_validity]);
  }
  const id = Number(run(
    'INSERT INTO passes (code, name, mobile, unit_id, purpose, validity, valid_from, valid_until, time_slot, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    freshCode(), b.name, b.mobile, b.unitId, b.purpose, s.pass_validity, from.toISOString(), until.toISOString(), slot, req.user!.id, nowIso(),
  ).lastInsertRowid);
  let p = one<PassRow>('SELECT * FROM passes WHERE id = ?', id)!;
  const when = (r => (r === 'Today' || r === 'Tomorrow' ? r.toLowerCase() : 'on ' + r))(relDay(d)) + (slot ? `, ${slot}` : '');
  if (s.auto_share_pass) {
    smsPass(p, `${s.name}: ${p.unit_id} has invited you (${when}). Entry code ${p.code}. Open your pass:`);
    p = one<PassRow>('SELECT * FROM passes WHERE id = ?', id)!;
  }
  logEvent('pass', p.name, p.unit_id, `${p.purpose} · ${relDay(d)}${slot ? ' ' + slot : ''}`, {
    actor: req.user, role: 'Resident',
    fields: [['Visitor mobile', fmtMobile(p.mobile)], ['Purpose', p.purpose], ['Code', p.code], ['Visit date', dayLabel(d)],
      ['Time slot', slot ?? `Any time · valid ${s.pass_validity}`], ['Sent by SMS', p.sent ? 'Yes' : 'No — resident shares it']],
  });
  invalidate('passes');
  res.status(201).json(passView(p));
});

member.post('/passes/:id/share', auth, (req, res) => {
  const p = one<PassRow>('SELECT * FROM passes WHERE id = ?', Number(req.params.id));
  if (!p || !belongsTo(p.unit_id, req.user!.id)) throw notFound('Pass not found.');
  if (p.revoked_at) throw conflict('This pass was revoked. Create a new one instead.');
  smsPass(p, `${society().name}: ${p.unit_id} has invited you. Entry code ${p.code}. Open your pass:`);
  invalidate('passes');
  res.json(passView(one<PassRow>('SELECT * FROM passes WHERE id = ?', p.id)!));
});

/**
 * Extend approval until the end of a given day. Extends an existing pass (making it reusable),
 * or issues a new reusable pass for a walk-in visitor.
 */
member.post('/passes/extend', auth, (req, res) => {
  const b = parse(z.object({ passId: z.number().int().optional(), visitId: z.number().int().optional(), until: day }), req.body);
  if (b.until < localDay()) throw bad('Pick today or a later date.');
  if (b.until > addDays(localDay(), 90)) throw bad('Approvals can be extended up to 90 days.');
  const s = society();
  const until = endOfDay(b.until).toISOString();
  let p: PassRow | undefined;

  if (b.passId) {
    p = one<PassRow>('SELECT * FROM passes WHERE id = ?', b.passId);
    if (!p || !belongsTo(p.unit_id, req.user!.id)) throw notFound('Pass not found.');
    if (p.revoked_at) throw conflict('This pass was revoked. Create a new one instead.');
    run('UPDATE passes SET valid_until = ?, valid_from = MIN(valid_from, ?), reusable = 1, used_at = NULL, time_slot = NULL WHERE id = ?', until, nowIso(), p.id);
  } else if (b.visitId) {
    const v = one<VisitRow>('SELECT * FROM visits WHERE id = ?', b.visitId);
    if (!v || !belongsTo(v.unit_id, req.user!.id)) throw notFound('Visit not found.');
    // Reuse a live pass for this visitor at this unit if one exists.
    const ex = one<PassRow>('SELECT * FROM passes WHERE unit_id = ? AND mobile = ? AND valid_until > ? AND revoked_at IS NULL ORDER BY id DESC LIMIT 1', v.unit_id, v.mobile, nowIso());
    if (ex) {
      run('UPDATE passes SET valid_until = MAX(valid_until, ?), reusable = 1, used_at = NULL, time_slot = NULL WHERE id = ?', until, ex.id);
      p = ex;
    } else {
      const id = Number(run(
        'INSERT INTO passes (code, name, mobile, unit_id, purpose, validity, valid_from, valid_until, reusable, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)',
        freshCode(), v.name, v.mobile, v.unit_id, v.purpose, s.pass_validity, nowIso(), until, req.user!.id, nowIso(),
      ).lastInsertRowid);
      p = one<PassRow>('SELECT * FROM passes WHERE id = ?', id)!;
    }
  } else throw bad('Choose a pass or visit to extend.');

  p = one<PassRow>('SELECT * FROM passes WHERE id = ?', p!.id)!;
  if (s.auto_share_pass) {
    smsPass(p, `${s.name}: ${p.unit_id} extended your approval until ${dayLabel(b.until)}. Entry code ${p.code}. Open your pass:`);
    p = one<PassRow>('SELECT * FROM passes WHERE id = ?', p.id)!;
  }
  logEvent('extend', p.name, p.unit_id, `Until ${dayLabel(b.until)}`, {
    actor: req.user, role: 'Resident',
    fields: [['Visitor mobile', fmtMobile(p.mobile)], ['Code', p.code], ['Valid until', dayLabel(b.until)], ['Repeat entries', 'Allowed'], ['Sent by SMS', s.auto_share_pass ? 'Yes' : 'No']],
  });
  invalidate('passes', 'visits');
  res.json({ pass: passView(p), message: `Approval for ${p.name} extended until ${dayLabel(b.until)}.` });
});

/** Cancel a pre-approved pass. The code stops working at the gate immediately. */
member.post('/passes/:id/revoke', auth, (req, res) => {
  const p = one<PassRow>('SELECT * FROM passes WHERE id = ?', Number(req.params.id));
  if (!p || !belongsTo(p.unit_id, req.user!.id)) throw notFound('Pass not found.');
  if (p.revoked_at) throw conflict('This pass is already revoked.');
  const st = passState(p);
  if (st === 'used' || st === 'expired') throw conflict(`This pass has already ${st === 'used' ? 'been used' : 'expired'}.`);
  run('UPDATE passes SET revoked_at = ? WHERE id = ?', nowIso(), p.id);
  logEvent('revoke', p.name, p.unit_id, `Code ${p.code} · by ${req.user!.name}`, {
    actor: req.user, role: 'Resident',
    fields: [['Visitor mobile', fmtMobile(p.mobile)], ['Code', p.code], ['Was valid', passView(p).validLabel], ['Visitor told by SMS', p.sent ? 'Yes' : 'No (pass was never sent)']],
  });
  if (p.sent) sendSms(p.mobile, `${society().name}: Your entry pass for ${p.unit_id} (code ${p.code}) has been cancelled by your host.`);
  invalidate('passes');
  res.json({ pass: passView(one<PassRow>('SELECT * FROM passes WHERE id = ?', p.id)!), message: `Pass for ${p.name} revoked. Code ${p.code} no longer works.` });
});

// ── Alerts to security ──────────────────────────────────────────────────────

member.post('/alerts', auth, (req, res) => {
  const b = parse(z.object({ unitId, type: z.enum(ALERT_TYPES), note: z.string().trim().max(280).default('') }), req.body);
  myUnit(b.unitId, req.user!.id);
  const me = req.user!;
  run('INSERT INTO alerts (type, note, unit_id, person_id, created_at) VALUES (?, ?, ?, ?, ?)', b.type, b.note, b.unitId, me.id, nowIso());
  logEvent('alert', me.name, b.unitId, b.type, { actor: me, role: 'Resident', fields: [['Alert', b.type], ['Note', b.note], ['Resident mobile', fmtMobile(me.mobile)]] });
  pushToRole('security', { text: `${b.type} · ${b.unitId} · ${me.name}`, tone: 'alert', link: '/gate' });
  invalidate('alerts');
  res.status(201).json({ ok: true });
});

member.get('/me/alerts', auth, (req, res) => {
  const rows = all<{ id: number; type: string; unit_id: string; status: string; created_at: string }>(
    "SELECT id, type, unit_id, status, created_at FROM alerts WHERE person_id = ? AND status != 'resolved' ORDER BY id DESC", req.user!.id);
  res.json(rows.map(a => ({ id: a.id, type: a.type, unitId: a.unit_id, status: a.status, time: localTime(a.created_at) })));
});

// ── Activity (member: one of my units; admin: any/all) ──────────────────────

member.get('/activity', requireRole('member', 'admin'), (req, res) => {
  const q = parse(z.object({ from: day, to: day, unit: z.string().optional() }), req.query);
  let [from, to] = q.from <= q.to ? [q.from, q.to] : [q.to, q.from];
  const isAdmin = req.user!.roles.includes('admin');
  const unit = q.unit?.toUpperCase();
  if (!isAdmin) {
    if (!unit) throw bad('Choose a unit.');
    myUnit(unit, req.user!.id);
  }
  type Ev = { id: number; day: string; at: string; unit_id: string; name: string; kind: string; detail: string;
    actor_name: string | null; actor_mobile: string | null; actor_role: string | null; data: string | null };
  const rows = unit
    ? all<Ev>('SELECT * FROM events WHERE unit_id = ? AND day BETWEEN ? AND ? ORDER BY at DESC LIMIT 1000', unit, from, to)
    : all<Ev>('SELECT * FROM events WHERE day BETWEEN ? AND ? ORDER BY at DESC LIMIT 1000', from, to);
  res.json({
    from, to, today: localDay(),
    items: rows.map(e => ({
      id: e.id, day: e.day, time: localTime(e.at), unitId: e.unit_id, name: e.name, kind: e.kind, detail: e.detail,
      // Full audit record is for admins only.
      ...(isAdmin ? {
        stamp: fullStamp(e.at),
        actor: e.actor_name ? { name: e.actor_name, mobile: e.actor_mobile, role: e.actor_role } : null,
        ...(e.data ? JSON.parse(e.data) : { fields: [], changes: [] }),
      } : {}),
    })),
  });
});
