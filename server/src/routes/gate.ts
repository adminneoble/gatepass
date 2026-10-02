import { Router } from 'express';
import { all, one, run, tx } from '../db/db.js';
import { checkOtp, issueOtp, requireRole } from '../auth.js';
import { logEvent, notify, personById, personLabel, recipientLabel, recipients, society, unitRow } from '../domain.js';
import { bad, conflict, notFound } from '../lib/errors.js';
import { invalidate } from '../lib/realtime.js';
import { sendSms } from '../lib/sms.js';
import { localDay, localTime, nowIso } from '../lib/time.js';
import { readPassToken } from '../lib/crypto.js';
import { PURPOSES, fmtMobile } from '../lib/format.js';
import { dataUrlImage, mobile, name, parse, unitId, z } from '../lib/validate.js';
import { passState, passView, visitView, type PassRow, type VisitRow } from '../views.js';
import { config } from '../config.js';

export const gate = Router();
const security = requireRole('security');

// ── Directory lookup for the New entry form ─────────────────────────────────

gate.get('/directory/search', security, (req, res) => {
  const q = String(req.query.q ?? '').trim().toLowerCase();
  if (!q) return res.json({ exact: null, suggestions: [] });
  const rows = all<{ id: string; type: string; owner: string; tenant: string | null }>(`
    SELECT u.id, u.type, o.name owner, t.name tenant FROM units u
    JOIN people o ON o.id = u.owner_id LEFT JOIN people t ON t.id = u.tenant_id ORDER BY u.id`);
  const exact = rows.find(r => r.id.toLowerCase() === q);
  const describe = (id: string) => recipients(id).map(r => ({ name: r.name, role: r.role, phone: fmtMobile(r.mobile) }));
  res.json({
    exact: exact ? { id: exact.id, type: exact.type, recipients: describe(exact.id) } : null,
    suggestions: exact ? [] : rows
      .filter(r => [r.id, r.owner, r.tenant].some(x => x && x.toLowerCase().includes(q)))
      .slice(0, 5)
      .map(r => ({ id: r.id, type: r.type, notifies: recipientLabel(r.id) })),
  });
});

// ── Visitor mobile OTP (when the admin requires it) ─────────────────────────

gate.post('/visitor-otp', security, (req, res) => {
  const { mobile: m } = parse(z.object({ mobile }), req.body);
  const code = issueOtp(m, 'visitor', c => `${c} is your ${society().name} gate OTP. Share it with security.`);
  res.json({ sent: true, ...(config.isProd ? {} : { devCode: code }) });
});

gate.post('/visitor-otp/verify', security, (req, res) => {
  const b = parse(z.object({ mobile, code: z.string().regex(/^\d{4}$/, 'Enter the 4-digit OTP.') }), req.body);
  checkOtp(b.mobile, 'visitor', b.code);
  res.json({ verified: true });
});

/** A visitor OTP for this mobile was verified in the last 20 minutes. */
// Only a successful check sets used_at on the latest OTP (issuing a new one supersedes older rows).
function visitorVerified(m: string) {
  const otp = one<{ used_at: string | null }>("SELECT used_at FROM otps WHERE mobile = ? AND purpose = 'visitor' ORDER BY id DESC LIMIT 1", m);
  return !!otp?.used_at && Date.now() - Date.parse(otp.used_at) < 20 * 60e3;
}

// ── Visits ───────────────────────────────────────────────────────────────────

/** Today's visits plus anything still open from earlier days. */
gate.get('/visits', security, (_req, res) => {
  const today = localDay();
  const rows = all<VisitRow>("SELECT * FROM visits WHERE day = ? OR status IN ('pending', 'approved', 'inside') ORDER BY id DESC", today);
  const views = rows.map(visitView);
  res.json({
    visits: views,
    // These always add up: inside + atGate + exited + denied = total (open visits from earlier days included).
    stats: {
      inside: rows.filter(v => v.status === 'inside').length,
      atGate: rows.filter(v => v.status === 'pending' || v.status === 'approved').length,
      exited: rows.filter(v => v.status === 'exited').length,
      denied: rows.filter(v => v.status === 'denied').length,
      total: rows.length,
    },
  });
});

gate.post('/visits', security, (req, res) => {
  const b = parse(z.object({ name, mobile, unitId, purpose: z.enum(PURPOSES), photo: dataUrlImage.nullable().optional() }), req.body);
  unitRow(b.unitId);
  if (society().otp_required && !visitorVerified(b.mobile)) throw bad('Verify the visitor\'s mobile with OTP first.', 'otp_required');
  const now = new Date();
  const id = Number(run(
    "INSERT INTO visits (name, mobile, unit_id, purpose, photo, status, via, day, created_at, logged_by) VALUES (?, ?, ?, ?, ?, 'pending', 'Walk-in', ?, ?, ?)",
    b.name, b.mobile, b.unitId, b.purpose, b.photo ?? null, localDay(now), now.toISOString(), req.user!.id,
  ).lastInsertRowid);
  logEvent('request', b.name, b.unitId, `Walk-in · ${b.purpose}`, {
    actor: req.user, role: 'Security',
    fields: [['Visitor mobile', fmtMobile(b.mobile)], ['Purpose', b.purpose], ['Photo', b.photo ? 'Captured' : 'Not taken'],
      ['Mobile verified', society().otp_required ? 'Yes, by OTP' : 'Not required'], ['Request sent to', recipientLabel(b.unitId)]],
  });
  const to = recipients(b.unitId);
  notify(to.map(r => r.id), `${b.name} is at the gate for ${b.unitId} · ${b.purpose}. Tap to approve.`, { link: '/app', tone: 'alert' });
  invalidate('visits');
  res.status(201).json({ visit: visitView(one<VisitRow>('SELECT * FROM visits WHERE id = ?', id)!), sentTo: recipientLabel(b.unitId) });
});

function loadVisit(id: number) {
  const v = one<VisitRow>('SELECT * FROM visits WHERE id = ?', id);
  if (!v) throw notFound('Visit not found.');
  return v;
}

gate.post('/visits/:id/enter', security, (req, res) => {
  const v = loadVisit(Number(req.params.id));
  if (v.status !== 'approved') throw conflict(v.status === 'pending' ? 'Still waiting for the resident to approve.' : `This visitor is already marked ${v.status}.`);
  run("UPDATE visits SET status = 'inside', entered_at = ? WHERE id = ?", nowIso(), v.id);
  logEvent('entry', v.name, v.unit_id, `${v.via} · ${v.purpose}`, {
    actor: req.user, role: 'Security',
    fields: [['Visitor mobile', fmtMobile(v.mobile)], ['Purpose', v.purpose], ['Arrived at gate', localTime(v.created_at)],
      ['Approved by', personLabel(v.decided_by ? personById(v.decided_by) : null)], ['Approved at', v.decided_at && localTime(v.decided_at)]],
  });
  invalidate('visits');
  res.json({ ok: true });
});

gate.post('/visits/:id/exit', security, (req, res) => {
  const v = loadVisit(Number(req.params.id));
  if (v.status !== 'inside') throw conflict('This visitor is not marked inside.');
  run("UPDATE visits SET status = 'exited', exited_at = ? WHERE id = ?", nowIso(), v.id);
  logEvent('exit', v.name, v.unit_id, '', {
    actor: req.user, role: 'Security',
    fields: [['Visitor mobile', fmtMobile(v.mobile)], ['Purpose', v.purpose], ['Came in via', v.via], ['Entered at', v.entered_at && localTime(v.entered_at)]],
  });
  invalidate('visits');
  res.json({ ok: true });
});

// Photos are served separately so lists stay light. Security and the unit's residents can see them.
gate.get('/visits/:id/photo', requireRole(), (req, res) => {
  const v = loadVisit(Number(req.params.id));
  const u = req.user!;
  const unit = one<{ owner_id: number; tenant_id: number | null }>('SELECT owner_id, tenant_id FROM units WHERE id = ?', v.unit_id);
  const allowed = u.roles.includes('security') || u.roles.includes('admin') || (unit && (unit.owner_id === u.id || unit.tenant_id === u.id));
  if (!allowed || !v.photo) throw notFound();
  const m = /^data:([^;]+);base64,(.*)$/.exec(v.photo);
  if (!m) throw notFound();
  res.setHeader('Content-Type', m[1]);
  res.setHeader('Cache-Control', 'private, max-age=86400');
  res.send(Buffer.from(m[2], 'base64'));
});

// ── Pass verification ───────────────────────────────────────────────────────

gate.post('/passes/verify', security, (req, res) => {
  const b = parse(z.object({ code: z.string().regex(/^\d{6}$/).optional(), token: z.string().max(200).optional() }), req.body);
  let candidates: PassRow[] = [];
  if (b.token) {
    // Accept a raw token or a full pass URL from a QR/RFID reader.
    const t = b.token.trim().split('/p/').pop()!;
    const id = readPassToken(t);
    const p = id && one<PassRow>('SELECT * FROM passes WHERE id = ?', id);
    if (p) candidates = [p];
  } else if (b.code) {
    candidates = all<PassRow>('SELECT * FROM passes WHERE code = ? ORDER BY id DESC', b.code);
  } else throw bad('Enter a code or scan a pass.');

  if (!candidates.length) return res.json({ ok: false, message: b.token ? 'This QR is not a valid Gatepass.' : 'No pass matches this code.' });
  const valid = candidates.find(p => passState(p) === 'valid');
  if (valid) return res.json({ ok: true, pass: passView(valid) });
  const p = candidates[0];
  const st = passState(p);
  const message =
    st === 'revoked' ? `This pass for ${p.name} was revoked by ${p.unit_id}. Do not allow entry.`
    : st === 'used' ? `Code already used by ${p.name} at ${localTime(p.used_at!)}.`
    : st === 'upcoming' ? `Too early: the pass for ${p.name} is for ${passView(p).validLabel}. Ask them to come back then.`
    : p.time_slot ? `Too late: the pass for ${p.name} was for ${passView(p).validLabel} and has expired.`
    : `This pass for ${p.name} has expired.`;
  res.json({ ok: false, message });
});

gate.post('/passes/:id/admit', security, (req, res) => {
  const p = one<PassRow>('SELECT * FROM passes WHERE id = ?', Number(req.params.id));
  if (!p) throw notFound('Pass not found.');
  if (passState(p) !== 'valid') throw conflict('This pass is no longer valid.');
  const now = new Date();
  tx(() => {
    run(
      "INSERT INTO visits (name, mobile, unit_id, purpose, status, via, pass_id, day, created_at, entered_at, logged_by) VALUES (?, ?, ?, ?, 'inside', 'Pass', ?, ?, ?, ?, ?)",
      p.name, p.mobile, p.unit_id, p.purpose, p.id, localDay(now), now.toISOString(), now.toISOString(), req.user!.id,
    );
    run('UPDATE passes SET used_at = ? WHERE id = ?', now.toISOString(), p.id);
  });
  logEvent('entry', p.name, p.unit_id, `Pass · ${p.purpose}`, {
    actor: req.user, role: 'Security',
    fields: [['Visitor mobile', fmtMobile(p.mobile)], ['Purpose', p.purpose], ['Pass code', p.code], ['Pass valid', passView(p).validLabel],
      ['Pass issued by', personLabel(personById(one<{ created_by: number }>('SELECT created_by FROM passes WHERE id = ?', p.id)!.created_by))]],
  });
  const creator = personById(one<{ created_by: number }>('SELECT created_by FROM passes WHERE id = ?', p.id)!.created_by);
  const ids = new Set(recipients(p.unit_id).map(r => r.id));
  if (creator) ids.add(creator.id);
  notify([...ids], `${p.name} has entered ${p.unit_id} with your pass.`, { link: '/app' });
  invalidate('visits', 'passes');
  res.json({ ok: true });
});

// ── Resident alerts ─────────────────────────────────────────────────────────

gate.get('/alerts/open', security, (_req, res) => {
  const rows = all<{ id: number; type: string; note: string; unit_id: string; status: string; created_at: string; name: string; mobile: string }>(`
    SELECT a.id, a.type, a.note, a.unit_id, a.status, a.created_at, p.name, p.mobile
    FROM alerts a JOIN people p ON p.id = a.person_id WHERE a.status != 'resolved' ORDER BY a.id DESC`);
  res.json(rows.map(a => ({ id: a.id, type: a.type, note: a.note, unitId: a.unit_id, status: a.status, time: localTime(a.created_at), name: a.name, mobile: a.mobile })));
});

gate.post('/alerts/:id/:action', security, (req, res) => {
  const action = parse(z.enum(['ack', 'resolve']), req.params.action);
  const a = one<{ id: number; type: string; unit_id: string; person_id: number; status: string }>('SELECT * FROM alerts WHERE id = ?', Number(req.params.id));
  if (!a) throw notFound('Alert not found.');
  if (action === 'ack') {
    if (a.status !== 'new') throw conflict('This alert was already acknowledged.');
    run("UPDATE alerts SET status = 'ack', ack_at = ? WHERE id = ?", nowIso(), a.id);
    notify([a.person_id], 'Security has seen your alert and is responding.', { link: '/app' });
  } else {
    if (a.status === 'resolved') throw conflict('This alert is already resolved.');
    run("UPDATE alerts SET status = 'resolved', resolved_at = ? WHERE id = ?", nowIso(), a.id);
    notify([a.person_id], 'Security marked your alert as resolved.', { link: '/app' });
    const raiser = personById(a.person_id)!;
    const full = one<{ note: string; created_at: string; ack_at: string | null }>('SELECT note, created_at, ack_at FROM alerts WHERE id = ?', a.id)!;
    logEvent('alert', raiser.name, a.unit_id, `${a.type} · resolved`, {
      actor: req.user, role: 'Security',
      fields: [['Alert', a.type], ['Note', full.note], ['Raised by', personLabel(raiser)], ['Raised at', localTime(full.created_at)],
        ['Acknowledged at', full.ack_at && localTime(full.ack_at)], ['Resolved at', localTime(new Date())]],
    });
  }
  invalidate('alerts');
  res.json({ ok: true });
});

// SMS the visitor after a resident decides (used by member routes).
export function smsDecision(v: VisitRow, approved: boolean) {
  const s = society();
  sendSms(v.mobile, approved ? `${s.name}: ${v.unit_id} approved your visit. Security will let you in.` : `${s.name}: ${v.unit_id} could not approve your visit.`);
}
