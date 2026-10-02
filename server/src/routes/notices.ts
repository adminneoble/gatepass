import { Router } from 'express';
import { all, insert, one, run, tx } from '../db/db.js';
import { idParam } from './gate.js';
import { requireRole } from '../auth.js';
import { notify, personById, society } from '../domain.js';
import { bad, conflict, notFound } from '../lib/errors.js';
import { invalidate } from '../lib/realtime.js';
import { sendSms } from '../lib/sms.js';
import { dayLabel, fullStamp, localDay, localTime, nowIso } from '../lib/time.js';
import { day, parse, z } from '../lib/validate.js';
import { config } from '../config.js';

export const notices = Router();
const admin = requireRole('admin');
const anyone = requireRole();

const PRIORITY = ['normal', 'important', 'urgent'] as const;

// ── Attachments ──────────────────────────────────────────────────────────────
const MAX_FILE = 5 * 1024 * 1024;
const MIMES = ['application/pdf', 'image/jpeg', 'image/png'] as const;
type Mime = (typeof MIMES)[number];
/** Check the file really is what it claims (by its first bytes), not just its extension. */
function sniff(buf: Buffer): Mime | null {
  if (buf.subarray(0, 5).toString('latin1') === '%PDF-') return 'application/pdf';
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  return null;
}
const attachmentOf = async (noticeId: number) => {
  const f = await one<{ name: string; mime: string; size: number }>('SELECT name, mime, size FROM notice_files WHERE notice_id = ?', noticeId);
  return f ? { name: f.name, mime: f.mime, size: f.size, kind: f.mime === 'application/pdf' ? 'pdf' : 'image', url: `/api/notices/${noticeId}/attachment` } : null;
};
const AUDIENCE = ['all', 'residents', 'security', 'blocks'] as const;
type Audience = (typeof AUDIENCE)[number];

/** Block/tower of a unit: the part before the dash ("A-101" → "A", "OFF-12" → "OFF"). */
const blockOf = (unitId: string) => unitId.split('-')[0];
const allBlocks = async () => [...new Set((await all<{ id: string }>('SELECT id FROM units ORDER BY id')).map(u => blockOf(u.id)))];

type Recipient = { id: number; role: 'Resident' | 'Security' };

/** Who receives a notice. Owners and tenants are both reached; a person is listed once. */
async function resolveAudience(audience: Audience, blocks: string[]): Promise<Recipient[]> {
  const out = new Map<number, Recipient>();
  const addResidents = async (unitFilter: (id: string) => boolean) => {
    for (const u of await all<{ id: string; owner_id: number; tenant_id: number | null }>('SELECT id, owner_id, tenant_id FROM units')) {
      if (!unitFilter(u.id)) continue;
      for (const pid of [u.owner_id, u.tenant_id]) if (pid && !out.has(pid)) out.set(pid, { id: pid, role: 'Resident' });
    }
  };
  if (audience === 'all' || audience === 'security')
    for (const s of await all<{ person_id: number }>("SELECT person_id FROM staff WHERE role = 'security'")) out.set(s.person_id, { id: s.person_id, role: 'Security' });
  if (audience === 'all' || audience === 'residents') await addResidents(() => true);
  if (audience === 'blocks') { const set = new Set(blocks); await addResidents(id => set.has(blockOf(id))); }
  return [...out.values()];
}

const audienceLabel = (a: Audience, blocks: string | null) =>
  a === 'all' ? 'Everyone' : a === 'residents' ? 'All residents' : a === 'security' ? 'Security staff' : `Block ${blocks?.split(',').join(', ')}`;

type NoticeRow = {
  id: number; title: string; body: string; priority: (typeof PRIORITY)[number]; audience: Audience; blocks: string | null;
  sms: number; created_by: number; created_at: string; expires_on: string | null; withdrawn_at: string | null;
};
const state = (n: NoticeRow) => (n.withdrawn_at ? 'withdrawn' : n.expires_on && n.expires_on < localDay() ? 'expired' : 'active');

async function noticeOut(n: NoticeRow) {
  return {
    id: n.id, title: n.title, body: n.body, priority: n.priority, audience: n.audience, audienceLabel: audienceLabel(n.audience, n.blocks),
    sms: !!n.sms, from: (await personById(n.created_by))?.name ?? 'Admin', sentAt: fullStamp(n.created_at), day: localDay(new Date(n.created_at)), time: localTime(n.created_at),
    expiresOn: n.expires_on, expiresLabel: n.expires_on && dayLabel(n.expires_on), state: state(n),
    attachment: await attachmentOf(n.id),
  };
}

// ── Admin ────────────────────────────────────────────────────────────────────

/** Audience preview for the compose sheet: available blocks and how many people a choice reaches. */
notices.get('/admin/notices/audience', admin, async (req, res) => {
  const q = parse(z.object({ audience: z.enum(AUDIENCE).default('all'), blocks: z.string().optional() }), req.query);
  const blocks = q.blocks ? q.blocks.split(',').filter(Boolean) : [];
  const r = await resolveAudience(q.audience, blocks);
  res.json({ blocks: await allBlocks(), count: r.length, residents: r.filter(x => x.role === 'Resident').length, security: r.filter(x => x.role === 'Security').length });
});

notices.post('/admin/notices', admin, async (req, res) => {
  const b = parse(z.object({
    title: z.string().trim().min(3, 'Add a short title.').max(100),
    body: z.string().trim().min(3, 'Write the message.').max(2000),
    priority: z.enum(PRIORITY).default('normal'),
    audience: z.enum(AUDIENCE).default('all'),
    blocks: z.array(z.string().trim().min(1)).default([]),
    sms: z.boolean().default(false),
    expiresOn: day.optional(),
    attachment: z.object({
      name: z.string().trim().min(1).max(120),
      data: z.string().max(Math.ceil(MAX_FILE / 3) * 4 + 4, 'The file is larger than 5 MB.'),   // base64
    }).optional(),
  }), req.body);
  let file: { name: string; mime: Mime; buf: Buffer } | null = null;
  if (b.attachment) {
    const buf = Buffer.from(b.attachment.data.replace(/^data:[^;]+;base64,/, ''), 'base64');
    if (buf.length > MAX_FILE) throw bad('The file is larger than 5 MB.');
    const mime = sniff(buf);
    if (!mime) throw bad('Attach a PDF, JPG or PNG file.');
    file = { name: b.attachment.name.replace(/[\\/\r\n"]/g, '_'), mime, buf };
  }
  if (b.audience === 'blocks' && !b.blocks.length) throw bad('Choose at least one block.');
  if (b.expiresOn && b.expiresOn < localDay()) throw bad('"Show until" must be today or later.');
  const recipients = await resolveAudience(b.audience, b.blocks);
  if (!recipients.length) throw bad('Nobody matches this audience yet.');

  const id = await tx(async () => {
    const id = await insert(
      'INSERT INTO notices (title, body, priority, audience, blocks, sms, created_by, created_at, expires_on) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      b.title, b.body, b.priority, b.audience, b.audience === 'blocks' ? b.blocks.join(',') : null, +b.sms, req.user!.id, nowIso(), b.expiresOn ?? null,
    );
    for (const r of recipients) await run('INSERT INTO notice_recipients (notice_id, person_id, role) VALUES (?, ?, ?)', id, r.id, r.role);
    if (file) await run('INSERT INTO notice_files (notice_id, name, mime, size, data) VALUES (?, ?, ?, ?, ?)', id, file.name, file.mime, file.buf.length, file.buf);
    return id;
  });

  // Live banner + bell entry, linked to each person's notice board.
  const tone = b.priority === 'normal' ? 'info' : 'alert';
  const text = `${b.priority === 'urgent' ? 'Urgent notice' : b.priority === 'important' ? 'Important notice' : 'New notice'}: ${b.title}`;
  const sec = recipients.filter(r => r.role === 'Security').map(r => r.id), res_ = recipients.filter(r => r.role === 'Resident').map(r => r.id);
  if (sec.length) await notify(sec, text, { tone, link: '/gate/notices' });
  if (res_.length) await notify(res_, text, { tone, link: '/app/notices' });

  if (b.sms) {
    const s = await society();
    const msg = `${s.name}${b.priority === 'urgent' ? ' URGENT' : ''}: ${b.title}. ${b.body.length > 140 ? b.body.slice(0, 137) + '…' : b.body}${file ? ' (Attachment in the app.)' : ''}`;
    for (const r of recipients) { const p = await personById(r.id); if (p) await sendSms(p.mobile, msg, `${config.publicUrl}/login`); }
  }
  invalidate('notices');
  res.status(201).json({ id, recipients: recipients.length, message: `Notice sent to ${recipients.length} ${recipients.length === 1 ? 'person' : 'people'}${b.sms ? ' (also by SMS)' : ''}.` });
});

notices.get('/admin/notices', admin, async (_req, res) => {
  const rows = await all<NoticeRow & { total: number; reads: number; acks: number }>(`
    SELECT n.*, COUNT(r.person_id) AS total, COUNT(r.read_at) AS reads, COUNT(r.ack_at) AS acks
    FROM notices n LEFT JOIN notice_recipients r ON r.notice_id = n.id GROUP BY n.id ORDER BY n.id DESC LIMIT 200`);
  res.json(await Promise.all(rows.map(async n => ({ ...(await noticeOut(n)), total: n.total, reads: n.reads, acks: n.acks }))));
});

notices.get('/admin/notices/:id', admin, async (req, res) => {
  const n = await one<NoticeRow>('SELECT * FROM notices WHERE id = ?', idParam(req.params.id));
  if (!n) throw notFound('Notice not found.');
  const people = await all<{ person_id: number; role: string; read_at: string | null; ack_at: string | null; name: string; mobile: string }>(`
    SELECT r.person_id, r.role, r.read_at, r.ack_at, p.name, p.mobile FROM notice_recipients r JOIN people p ON p.id = r.person_id
    WHERE r.notice_id = ? ORDER BY (r.read_at IS NOT NULL), p.name`, n.id);
  const unitsOf = async (pid: number) => (await all<{ id: string }>('SELECT id FROM units WHERE owner_id = ? OR tenant_id = ? ORDER BY id', pid, pid)).map(u => u.id).join(', ');
  res.json({
    notice: await noticeOut(n),
    recipients: await Promise.all(people.map(async p => ({
      name: p.name, mobile: p.mobile, role: p.role, units: p.role === 'Resident' ? await unitsOf(p.person_id) : '',
      readAt: p.read_at && fullStamp(p.read_at), ackAt: p.ack_at && fullStamp(p.ack_at),
    }))),
  });
});

notices.post('/admin/notices/:id/withdraw', admin, async (req, res) => {
  const n = await one<NoticeRow>('SELECT * FROM notices WHERE id = ?', idParam(req.params.id));
  if (!n) throw notFound('Notice not found.');
  if (n.withdrawn_at) throw conflict('This notice is already withdrawn.');
  await run('UPDATE notices SET withdrawn_at = ? WHERE id = ?', nowIso(), n.id);
  invalidate('notices');
  res.json({ message: `"${n.title}" withdrawn. It no longer shows on notice boards.` });
});

/** Attachment download: the admin, or anyone the notice was sent to (while it isn't withdrawn). */
notices.get('/notices/:id/attachment', anyone, async (req, res) => {
  const id = idParam(req.params.id);
  const n = await one<NoticeRow>('SELECT * FROM notices WHERE id = ?', id);
  const isAdmin = req.user!.roles.includes('admin');
  const isRecipient = !!(await one('SELECT 1 FROM notice_recipients WHERE notice_id = ? AND person_id = ?', id, req.user!.id));
  if (!n || !(isAdmin || (isRecipient && !n.withdrawn_at))) throw notFound('Attachment not found.');
  const f = await one<{ name: string; mime: string; data: Uint8Array }>('SELECT name, mime, data FROM notice_files WHERE notice_id = ?', id);
  if (!f) throw notFound('Attachment not found.');
  res.setHeader('Content-Type', f.mime);
  // ASCII fallback plus RFC 5987 form so non-English file names work.
  res.setHeader('Content-Disposition', `inline; filename="${f.name.replace(/[^\x20-\x7e]/g, '_')}"; filename*=UTF-8''${encodeURIComponent(f.name)}`);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cache-Control', 'private, max-age=3600');
  res.send(Buffer.from(f.data));
});

// ── Residents & security ─────────────────────────────────────────────────────

/** My active notices (not withdrawn, not past "show until"), newest first, with read/ack state. */
notices.get('/me/notices', anyone, async (req, res) => {
  const rows = await all<NoticeRow & { read_at: string | null; ack_at: string | null }>(`
    SELECT n.*, r.read_at, r.ack_at FROM notices n JOIN notice_recipients r ON r.notice_id = n.id
    WHERE r.person_id = ? AND n.withdrawn_at IS NULL AND (n.expires_on IS NULL OR n.expires_on >= ?)
    ORDER BY n.id DESC LIMIT 100`, req.user!.id, localDay());
  const items = await Promise.all(rows.map(async n => ({ ...(await noticeOut(n)), read: !!n.read_at, needsAck: n.priority === 'urgent' && !n.ack_at, ackedAt: n.ack_at && fullStamp(n.ack_at) })));
  res.json({ unread: items.filter(i => !i.read).length, pendingAck: items.filter(i => i.needsAck).length, items });
});

notices.post('/me/notices/:id/:action', anyone, async (req, res) => {
  const action = parse(z.enum(['read', 'ack']), req.params.action);
  const id = idParam(req.params.id);
  const r = await one('SELECT 1 FROM notice_recipients WHERE notice_id = ? AND person_id = ?', id, req.user!.id);
  if (!r) throw notFound('Notice not found.');
  const now = nowIso();
  if (action === 'read') await run('UPDATE notice_recipients SET read_at = COALESCE(read_at, ?) WHERE notice_id = ? AND person_id = ?', now, id, req.user!.id);
  else await run('UPDATE notice_recipients SET read_at = COALESCE(read_at, ?), ack_at = COALESCE(ack_at, ?) WHERE notice_id = ? AND person_id = ?', now, now, id, req.user!.id);
  invalidate('notices');
  res.json({ ok: true });
});
