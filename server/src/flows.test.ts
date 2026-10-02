import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Server } from 'node:http';

const dir = mkdtempSync(join(tmpdir(), 'gatepass-test-'));
process.env.DATABASE_FILE = join(dir, 'test.db');

let server: Server;
let base = '';

before(async () => {
  const { migrate } = await import('./db/db.js');
  const { seed } = await import('./db/seed.js');
  const { createApp } = await import('./app.js');
  migrate();
  seed();
  await new Promise<void>(r => { server = createApp().listen(0, () => r()); });
  const addr = server.address();
  base = `http://localhost:${typeof addr === 'object' && addr ? addr.port : 0}/api`;
});
after(() => { server?.close(); rmSync(dir, { recursive: true, force: true }); });

/** A client with its own cookie jar. */
function client() {
  let cookie = '';
  const call = async (method: string, path: string, body?: unknown) => {
    const r = await fetch(base + path, {
      method, headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const set = r.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    const data = await r.json().catch(() => null);
    return { status: r.status, data } as { status: number; data: any };
  };
  return {
    raw: (p: string) => fetch(base + p, { headers: cookie ? { Cookie: cookie } : {} }),
    get: (p: string) => call('GET', p), post: (p: string, b?: unknown) => call('POST', p, b ?? {}),
    patch: (p: string, b: unknown) => call('PATCH', p, b), del: (p: string) => call('DELETE', p),
    async login(mobile: string) {
      const o = await call('POST', '/auth/otp', { mobile });
      assert.equal(o.status, 200, JSON.stringify(o.data));
      const v = await call('POST', '/auth/verify', { mobile, code: o.data.devCode });
      assert.equal(v.status, 200, JSON.stringify(v.data));
      return v.data.user;
    },
  };
}

// Login OTP rate limit is 20 s per number, so each role signs in once and is shared.
const guard = client(), ananya = client(), adminC = client(), vikas = client();

test('sign-in assigns roles; unknown numbers are rejected', async () => {
  assert.deepEqual((await guard.login('9800012345')).roles, ['security']);
  assert.deepEqual((await ananya.login('9811100001')).roles, ['member']);
  assert.deepEqual((await adminC.login('9800000001')).roles, ['admin']);
  await vikas.login('9811100002');
  const r = await client().post('/auth/otp', { mobile: '9999999999' });
  assert.equal(r.status, 404);
  const wrong = client();
  await wrong.post('/auth/otp', { mobile: '9811100011' });
  assert.equal((await wrong.post('/auth/verify', { mobile: '9811100011', code: '0000' })).status, 400);
});

test('role guards', async () => {
  assert.equal((await ananya.get('/visits')).status, 403);
  assert.equal((await guard.get('/admin/units')).status, 403);
  assert.equal((await client().get('/society')).status, 401);
});

test('walk-in: routing, approval, entry, exit', async () => {
  // C-110 is diverted to tenant Vikas, so Ananya (owner) is not notified.
  const s = await guard.get('/directory/search?q=c-110');
  assert.equal(s.data.exact.recipients[0].name, 'Vikas Iyer');
  const v = await guard.post('/visits', { name: 'Test Courier', mobile: '9000000001', unitId: 'c-110', purpose: 'Delivery' });
  assert.equal(v.status, 201);
  assert.match(v.data.sentTo, /Vikas Iyer \(Tenant\)/);
  const id = v.data.visit.id;
  assert.ok(!(await ananya.get('/me/requests')).data.some((x: any) => x.id === id));
  assert.ok((await vikas.get('/me/requests')).data.some((x: any) => x.id === id));
  assert.equal((await ananya.post(`/visits/${id}/decision`, { decision: 'approved' })).status, 403);
  assert.equal((await guard.post(`/visits/${id}/enter`)).status, 409); // not yet approved
  assert.equal((await vikas.post(`/visits/${id}/decision`, { decision: 'approved' })).status, 200);
  assert.equal((await vikas.post(`/visits/${id}/decision`, { decision: 'denied' })).status, 409);
  assert.equal((await guard.post(`/visits/${id}/enter`)).status, 200);
  assert.equal((await guard.post(`/visits/${id}/exit`)).status, 200);
  const sms = await client().get('/dev/sms?mobile=9000000001');
  assert.match(sms.data.messages.at(-1).body, /approved your visit/);
});

test('owner cc toggle adds owner as recipient', async () => {
  assert.equal((await ananya.patch('/me/units/C-110/routing', { ccOwner: true })).status, 200);
  const s = await guard.get('/directory/search?q=C-110');
  assert.deepEqual(s.data.exact.recipients.map((r: any) => r.role), ['Tenant', 'Owner']);
  assert.equal((await vikas.patch('/me/units/C-110/routing', { ccOwner: false })).status, 403);
});

test('visitor OTP required when enabled', async () => {
  await adminC.patch('/society', { otpRequired: true });
  const body = { name: 'OTP Guest', mobile: '9000000002', unitId: 'A-101', purpose: 'Guest' };
  assert.equal((await guard.post('/visits', body)).status, 400);
  const o = await guard.post('/visitor-otp', { mobile: body.mobile });
  assert.equal((await guard.post('/visitor-otp/verify', { mobile: body.mobile, code: o.data.devCode })).status, 200);
  assert.equal((await guard.post('/visits', body)).status, 201);
  await adminC.patch('/society', { otpRequired: false });
});

test('pre-approved pass: verify by code and token, single use, extend makes reusable', async () => {
  const p = await ananya.post('/passes', { unitId: 'B-402', name: 'Pass Guest', mobile: '9000000003', purpose: 'Guest', date: 'Today' });
  assert.equal(p.status, 201);
  assert.equal(p.data.sent, true); // auto-share on
  const pub = await client().get('/p/' + p.data.token);
  assert.equal(pub.data.pass.state, 'valid');
  assert.equal((await client().get('/p/1.AAAAAAAAAAAAAAAAAAAAAA')).status, 404);

  const byCode = await guard.post('/passes/verify', { code: p.data.code });
  assert.equal(byCode.data.ok, true);
  const byQr = await guard.post('/passes/verify', { token: p.data.url });
  assert.equal(byQr.data.pass.id, p.data.id);
  assert.equal((await guard.post(`/passes/${p.data.id}/admit`)).status, 200);
  const again = await guard.post('/passes/verify', { code: p.data.code });
  assert.equal(again.data.ok, false);
  assert.match(again.data.message, /already used by Pass Guest/);

  const until = new Date(Date.now() + 3 * 864e5).toISOString().slice(0, 10);
  const ext = await ananya.post('/passes/extend', { passId: p.data.id, until });
  assert.equal(ext.status, 200);
  assert.equal(ext.data.pass.reusable, true);
  assert.equal((await guard.post('/passes/verify', { code: p.data.code })).data.ok, true);
  assert.equal((await guard.post(`/passes/${p.data.id}/admit`)).status, 200);
  assert.equal((await guard.post('/passes/verify', { code: p.data.code })).data.ok, true); // still reusable
});

test('members cannot touch units that are not theirs', async () => {
  assert.equal((await ananya.post('/passes', { unitId: 'A-101', name: 'X', mobile: '9000000004', purpose: 'Guest', date: 'Today' })).status, 403);
  assert.equal((await ananya.get('/activity?from=2020-01-01&to=2030-01-01&unit=A-101')).status, 403);
});

test('alerts lifecycle notifies the member', async () => {
  assert.equal((await ananya.post('/alerts', { unitId: 'B-402', type: 'Lift stuck', note: 'Tower B' })).status, 201);
  const open = await guard.get('/alerts/open');
  const a = open.data.find((x: any) => x.note === 'Tower B');
  assert.equal(a.status, 'new');
  assert.equal((await guard.post(`/alerts/${a.id}/ack`)).status, 200);
  assert.equal((await guard.post(`/alerts/${a.id}/resolve`)).status, 200);
  const n = await ananya.get('/me/notifications');
  assert.match(n.data.items[0].text, /resolved/);
  assert.equal((await ananya.get('/me/alerts')).data.length, 0);
});

test('tenant request: owner asks, admin approves, tenant can sign in', async () => {
  assert.equal((await ananya.post('/me/units/B-402/tenant-requests', { kind: 'add', name: 'New Tenant', mobile: '9000000005' })).status, 201);
  assert.equal((await ananya.post('/me/units/B-402/tenant-requests', { kind: 'add', name: 'Dup', mobile: '9000000006' })).status, 409);
  const reqs = await adminC.get('/admin/tenant-requests');
  const r = reqs.data.find((x: any) => x.unitId === 'B-402');
  assert.equal((await adminC.post(`/admin/tenant-requests/${r.id}/approve`)).status, 200);
  const units = await ananya.get('/me/units');
  assert.equal(units.data.find((u: any) => u.id === 'B-402').tenant.name, 'New Tenant');
  const t = client();
  assert.deepEqual((await t.login('9000000005')).roles, ['member']);
});

test('admin edits: add unit, replace owner, conflicting mobile rejected', async () => {
  const add = await adminC.post('/admin/members', { unitId: 'd-201', type: 'Flat', name: 'Dev Owner', mobile: '9000000007' });
  assert.equal(add.status, 201);
  const units = await adminC.get('/admin/units');
  assert.ok(units.data.some((u: any) => u.id === 'D-201'));
  const clash = await adminC.patch('/admin/units/D-201', { owner: { name: 'Dev Owner', mobile: '9811100001' }, tenant: null });
  assert.equal(clash.status, 409);
});

test('profile mobile change requires OTP to the new number', async () => {
  const m = client();
  await m.login('9811100014'); // Meera
  const step1 = await m.patch('/me/profile', { name: 'Meera Pillai', mobile: '9000000008' });
  assert.equal(step1.data.otpSent, true);
  const bad = await m.patch('/me/profile', { name: 'Meera Pillai', mobile: '9000000008', code: '0000' === step1.data.devCode ? '1111' : '0000' });
  assert.equal(bad.status, 400);
  const ok = await m.patch('/me/profile', { name: 'Meera Pillai', mobile: '9000000008', code: step1.data.devCode });
  assert.equal(ok.status, 200);
  assert.equal((await m.get('/auth/me')).data.user.mobile, '9000000008');
  assert.equal((await m.patch('/me/profile', { name: 'Meera', mobile: '9811100001' })).status, 409);
});

test('activity is scoped and grouped by day', async () => {
  const today = (await ananya.get('/activity?from=2000-01-01&to=2000-01-01&unit=B-402')).data.today;
  const r = await ananya.get(`/activity?from=${today}&to=${today}&unit=B-402`);
  assert.ok(r.data.items.length > 0);
  assert.ok(r.data.items.every((e: any) => e.unitId === 'B-402'));
  const all = await adminC.get(`/activity?from=${today}&to=${today}`);
  assert.ok(new Set(all.data.items.map((e: any) => e.unitId)).size > 1);
});

test('admin chooses who is notified when editing a unit with a tenant', async () => {
  const body = (notify: string) => ({ owner: { name: 'Farah Khan', mobile: '9811100012' }, tenant: { name: 'Arjun Das', mobile: '9811100013' }, notify });
  const roles = async () => (await guard.get('/directory/search?q=A-304')).data.exact.recipients.map((r: any) => r.role);
  assert.equal((await adminC.patch('/admin/units/A-304', body('Owner'))).status, 200);
  assert.deepEqual(await roles(), ['Owner']);
  await adminC.patch('/admin/units/A-304', body('Both'));
  assert.deepEqual(await roles(), ['Tenant', 'Owner']);
  await adminC.patch('/admin/units/A-304', body('Tenant'));
  assert.deepEqual(await roles(), ['Tenant']);
  // Adding a tenant to an existing unit honours the choice too.
  await adminC.post('/admin/members', { unitId: 'C-203', role: 'Tenant', name: 'New Renter', mobile: '9000000010', notify: 'Both' });
  assert.deepEqual((await guard.get('/directory/search?q=C-203')).data.exact.recipients.map((r: any) => r.role), ['Tenant', 'Owner']);
});

test('approving an add-tenant request applies the chosen recipients', async () => {
  await adminC.post('/admin/members', { unitId: 'E-501', type: 'Flat', name: 'Owner Five', mobile: '9000000020' });
  const o = client();
  await o.login('9000000020');
  assert.equal((await o.post('/me/units/E-501/tenant-requests', { kind: 'add', name: 'Renter Five', mobile: '9000000021' })).status, 201);
  const r = (await adminC.get('/admin/tenant-requests')).data.find((x: any) => x.unitId === 'E-501');
  assert.equal((await adminC.post(`/admin/tenant-requests/${r.id}/approve`, { notify: 'Owner' })).status, 200);
  assert.deepEqual((await guard.get('/directory/search?q=E-501')).data.exact.recipients.map((x: any) => x.role), ['Owner']);
});

test('member revokes a pre-approved pass; gate rejects it and visitor is told', async () => {
  const p = (await ananya.post('/passes', { unitId: 'B-402', name: 'Revoked Guest', mobile: '9000000030', purpose: 'Guest', date: 'Today' })).data;
  assert.equal((await vikas.post(`/passes/${p.id}/revoke`)).status, 404); // not Vikas's unit
  const r = await ananya.post(`/passes/${p.id}/revoke`);
  assert.equal(r.status, 200);
  assert.equal(r.data.pass.state, 'revoked');
  assert.equal((await ananya.post(`/passes/${p.id}/revoke`)).status, 409);
  const v = await guard.post('/passes/verify', { code: p.code });
  assert.equal(v.data.ok, false);
  assert.match(v.data.message, /revoked by B-402/);
  assert.equal((await guard.post('/passes/verify', { token: p.token })).data.ok, false);
  assert.equal((await guard.post(`/passes/${p.id}/admit`)).status, 409);
  assert.equal((await client().get('/p/' + p.token)).data.pass.state, 'revoked');
  assert.equal((await ananya.post('/passes/extend', { passId: p.id, until: new Date(Date.now() + 864e5).toISOString().slice(0, 10) })).status, 409);
  const sms = await client().get('/dev/sms?mobile=9000000030');
  assert.match(sms.data.messages.at(-1).body, /has been cancelled/);
  const day = (await ananya.get('/activity?from=2000-01-01&to=2000-01-01&unit=B-402')).data.today;
  assert.ok((await ananya.get(`/activity?from=${day}&to=${day}&unit=B-402`)).data.items.some((e: any) => e.kind === 'revoke'));
});

test('pass date within 3 days and optional time slot enforced at the gate', async () => {
  const base = { unitId: 'B-402', name: 'Slot Guest', mobile: '9000000040', purpose: 'Guest' };
  const today = (await ananya.get('/activity?from=2000-01-01&to=2000-01-01&unit=B-402')).data.today as string;
  const plus = (n: number) => { const d = new Date(today + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

  assert.equal((await ananya.post('/passes', { ...base, date: plus(4) })).status, 400);       // beyond 3 days
  assert.equal((await ananya.post('/passes', { ...base, date: plus(-1) })).status, 400);      // past
  assert.equal((await ananya.post('/passes', { ...base, date: plus(2), slotFrom: '14:00' })).status, 400); // half a slot
  assert.equal((await ananya.post('/passes', { ...base, date: plus(2), slotFrom: '16:00', slotTo: '14:00' })).status, 400);

  // Picked date, no slot: scheduled for that day.
  const later = await ananya.post('/passes', { ...base, date: plus(3) });
  assert.equal(later.status, 201);
  assert.equal(later.data.state, 'upcoming');

  // Future slot: gate says too early.
  const slot = await ananya.post('/passes', { ...base, date: plus(1), slotFrom: '14:00', slotTo: '16:00' });
  assert.equal(slot.status, 201);
  assert.match(slot.data.validLabel, /Tomorrow · 14:00–16:00/);
  const early = await guard.post('/passes/verify', { code: slot.data.code });
  assert.equal(early.data.ok, false);
  assert.match(early.data.message, /Too early.*14:00–16:00/);

  // Slot covering now: valid.
  const now = await ananya.post('/passes', { ...base, date: 'Today', slotFrom: '00:00', slotTo: '23:59' });
  assert.equal((await guard.post('/passes/verify', { code: now.data.code })).data.ok, true);
});

test('gate stats always add up to the total', async () => {
  const { stats, visits } = (await guard.get('/visits')).data;
  assert.equal(stats.inside + stats.atGate + stats.exited + stats.denied, stats.total);
  assert.equal(stats.total, visits.length);
});

test('admin sees full audit record (actor, details, before→after); residents do not', async () => {
  await adminC.post('/admin/members', { unitId: 'F-601', type: 'Flat', name: 'Audit Owner', mobile: '9000000050' });
  await adminC.patch('/admin/units/F-601', { owner: { name: 'Audit Owner Renamed', mobile: '9000000050' }, tenant: { name: 'Audit Tenant', mobile: '9000000051' }, notify: 'Both' });
  const today = (await adminC.get('/activity?from=2000-01-01&to=2000-01-01')).data.today;
  const items = (await adminC.get(`/activity?from=${today}&to=${today}&unit=F-601`)).data.items;
  const add = items.find((e: any) => e.detail === 'Owner added by admin');
  assert.equal(add.actor.name, 'Kavita Desai');
  assert.equal(add.actor.role, 'Admin');
  assert.ok(add.fields.some(([k, v]: string[]) => k === 'Action' && /New flat created/.test(v)));
  const edit = items.find((e: any) => e.detail === 'Details updated by admin');
  const ch = Object.fromEntries(edit.changes.map((c: any) => [c.field, [c.from, c.to]]));
  assert.deepEqual(ch['Owner name'], ['Audit Owner', 'Audit Owner Renamed']);
  assert.equal(ch['Tenant'][0], '—');
  assert.match(ch['Tenant'][1], /Audit Tenant/);
  assert.match(ch['Visitor requests go to'][1], /Audit Tenant \(Tenant\) and Audit Owner Renamed \(Owner\)/);
  assert.match(edit.stamp, /\d{2}:\d{2}:\d{2}/);
  // Resident view of their own unit has no audit fields.
  const own = (await ananya.get(`/activity?from=${today}&to=${today}&unit=B-402`)).data.items[0];
  assert.equal(own.actor, undefined);
  assert.equal(own.changes, undefined);
});

test('admin notices: audiences, read/ack receipts, SMS, withdraw', async () => {
  // Only admins can send.
  assert.equal((await ananya.post('/admin/notices', { title: 'Hi there', body: 'Nope' })).status, 403);

  // Block targeting reaches owners and tenants of that block only.
  const prev = await adminC.get('/admin/notices/audience?audience=blocks&blocks=C');
  assert.ok(prev.data.blocks.includes('C'));
  const c = await adminC.post('/admin/notices', { title: 'Water shutdown C', body: 'No water 10–2 tomorrow in C block.', audience: 'blocks', blocks: ['C'] });
  assert.equal(c.status, 201);
  assert.equal(c.data.recipients, prev.data.count);
  assert.ok((await ananya.get('/me/notices')).data.items.some((n: any) => n.id === c.data.id));   // owns C-110
  assert.ok(!(await guard.get('/me/notices')).data.items.some((n: any) => n.id === c.data.id));   // security not included

  // Urgent to everyone, with SMS: security and residents receive; ack required.
  const u = await adminC.post('/admin/notices', { title: 'Fire drill', body: 'Fire drill at 5 pm today. Please assemble at the gate.', priority: 'urgent', audience: 'all', sms: true });
  assert.equal(u.status, 201);
  const mine = (await guard.get('/me/notices')).data;
  const n = mine.items.find((x: any) => x.id === u.data.id);
  assert.equal(n.needsAck, true);
  assert.ok(mine.pendingAck >= 1);
  assert.match((await client().get('/dev/sms?mobile=9800012345')).data.messages.at(-1).body, /URGENT: Fire drill/);

  await ananya.post(`/me/notices/${u.data.id}/read`);
  await guard.post(`/me/notices/${u.data.id}/ack`);
  const list = (await adminC.get('/admin/notices')).data.find((x: any) => x.id === u.data.id);
  assert.equal(list.reads, 2);
  assert.equal(list.acks, 1);
  const detail = (await adminC.get(`/admin/notices/${u.data.id}`)).data;
  assert.ok(detail.recipients.find((r: any) => r.mobile === '9800012345').ackAt);
  assert.equal(detail.recipients.find((r: any) => r.mobile === '9811100001').units, 'B-402, C-110');

  // Withdraw hides it from inboxes.
  assert.equal((await adminC.post(`/admin/notices/${u.data.id}/withdraw`)).status, 200);
  assert.ok(!(await guard.get('/me/notices')).data.items.some((x: any) => x.id === u.data.id));
  assert.equal((await adminC.post(`/admin/notices/${u.data.id}/withdraw`)).status, 409);
  // Cannot read someone else's notice.
  assert.equal((await guard.post(`/me/notices/${c.data.id}/read`)).status, 404);
});

test('notice attachments: PDF/JPG/PNG only, ≤5 MB, visible to recipients and admin only', async () => {
  const png = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8ffff3f0005fe02fea7d6a4b20000000049454e44ae426082', 'hex');
  const pdf = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF');
  const base = { title: 'Lift maintenance', body: 'Lift B closed 10–12.', audience: 'blocks', blocks: ['C'] };

  // Wrong type (a text file renamed .pdf) is rejected by content, not extension.
  assert.equal((await adminC.post('/admin/notices', { ...base, attachment: { name: 'fake.pdf', data: Buffer.from('hello').toString('base64') } })).status, 400);
  // Over 5 MB rejected.
  const big = Buffer.concat([Buffer.from('%PDF-'), Buffer.alloc(5 * 1024 * 1024)]);
  assert.equal((await adminC.post('/admin/notices', { ...base, attachment: { name: 'big.pdf', data: big.toString('base64') } })).status, 400);

  const withPdf = await adminC.post('/admin/notices', { ...base, attachment: { name: 'सूचना schedule.pdf', data: pdf.toString('base64') } });
  assert.equal(withPdf.status, 201);
  const withPng = await adminC.post('/admin/notices', { ...base, attachment: { name: 'photo.png', data: 'data:image/png;base64,' + png.toString('base64') } });
  assert.equal(withPng.status, 201);

  const mine = (await ananya.get('/me/notices')).data.items;     // Ananya owns C-110 → recipient
  const a = mine.find((n: any) => n.id === withPdf.data.id).attachment;
  assert.equal(a.kind, 'pdf');
  assert.equal(a.size, pdf.length);
  assert.equal(mine.find((n: any) => n.id === withPng.data.id).attachment.mime, 'image/png');

  // Download: recipient OK with correct type; non-recipient (security, not in block C) refused; admin OK.
  const dl = async (who: ReturnType<typeof client>, id: number) => (who as any).raw(`/notices/${id}/attachment`);
  for (const [who, ok] of [[ananya, true], [guard, false], [adminC, true]] as const) {
    const r = await dl(who, withPdf.data.id);
    assert.equal(r.status, ok ? 200 : 404);
    if (ok) assert.equal(r.headers.get('content-type'), 'application/pdf');
  }
});
