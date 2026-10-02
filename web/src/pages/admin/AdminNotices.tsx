import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Ban, Eye, Megaphone, MessageSquareText, Send } from 'lucide-react';
import { api } from '../../lib/api';
import { useFeedback } from '../../lib/feedback';
import { addDays, fmtMobile, isoDay, plural } from '../../lib/format';
import { Avatar, Button, Chips, Empty, Field, Seg, SectionHead, Sheet, Skeleton, Tag, TextField, Toggle, css } from '../../ui';
import { PRIORITY_META, type Priority } from '../shared/Notices';
import { AttachmentPicker, AttachmentView, type AttachmentInfo, type PickedFile } from '../shared/Attachment';

type Audience = 'all' | 'residents' | 'security' | 'blocks';
type SentNotice = {
  id: number; title: string; body: string; priority: Priority; audienceLabel: string; sms: boolean; from: string; sentAt: string;
  expiresLabel: string | null; state: 'active' | 'expired' | 'withdrawn'; total: number; reads: number; acks: number; attachment: AttachmentInfo | null;
};
type Receipt = { name: string; mobile: string; role: string; units: string; readAt: string | null; ackAt: string | null };

const AUDIENCES: Record<string, Audience> = { Everyone: 'all', 'All residents': 'residents', 'Security staff': 'security', 'Selected blocks': 'blocks' };
const PRIORITIES = ['Normal', 'Important', 'Urgent'] as const;

export default function AdminNotices() {
  const q = useQuery({ queryKey: ['notices', 'admin'], queryFn: () => api.get<SentNotice[]>('/admin/notices') });
  const [composing, setComposing] = useState(false);
  const [viewing, setViewing] = useState<SentNotice | null>(null);
  const [withdrawing, setWithdrawing] = useState<SentNotice | null>(null);
  const list = q.data ?? [];
  return (
    <div className="stack">
      <section className="card accent compose-hero" style={{ paddingTop: 20 }}>
        <div className="row" style={css({ '--gap': '12px' })}>
          <div className="icon-tile toned tone-violet" style={{ width: 44, height: 44 }}><Megaphone size={22} /></div>
          <div className="grow stack" style={css({ '--gap': '2px' })}>
            <span className="title-sm">Send a notice</span>
            <span className="meta">Reach every resident (owners and tenants), security staff, or selected blocks. Urgent notices ask everyone to acknowledge.</span>
          </div>
        </div>
        <div><Button variant="primary" icon={Send} onClick={() => setComposing(true)}>Compose notice</Button></div>
      </section>

      <SectionHead title="Sent notices" count={list.length} />
      {q.isLoading ? <Skeleton h={120} n={2} /> : list.length === 0
        ? <Empty icon={Megaphone} title="Nothing sent yet">Notices you send appear here with read receipts.</Empty>
        : list.map(n => {
          const meta = PRIORITY_META[n.priority];
          const pct = n.total ? Math.round((n.reads / n.total) * 100) : 0;
          return (
            <article key={n.id} className={`card notice-card p-${n.priority}` + (n.state !== 'active' ? ' faded' : '')}>
              <div className="card-head">
                <div className={`icon-tile ${n.priority === 'urgent' ? 'danger' : n.priority === 'important' ? 'toned tone-amber' : 'toned tone-indigo'}`}><meta.icon size={18} /></div>
                <div className="grow stack" style={css({ '--gap': '0' })}>
                  <span className="notice-title">{n.title}</span>
                  <span className="micro">{n.audienceLabel} · {n.sentAt}{n.sms ? ' · also by SMS' : ''}{n.expiresLabel ? ` · until ${n.expiresLabel}` : ''}</span>
                </div>
                {n.state === 'active' ? <Tag tone={meta.tag}>{meta.label}</Tag> : <Tag tone="neutral">{n.state === 'withdrawn' ? 'Withdrawn' : 'Expired'}</Tag>}
              </div>
              <p className="notice-body clamp">{n.body}</p>
              {n.attachment && <AttachmentView a={n.attachment} />}
              <div className="stack" style={css({ '--gap': '6px' })}>
                <div className="row between micro">
                  <span><strong style={{ color: 'var(--ink)' }}>Read by {n.reads} of {n.total}</strong>{n.priority === 'urgent' ? ` · ${n.acks} acknowledged` : ''}</span>
                  <span className="num">{pct}%</span>
                </div>
                <div className="progress"><span style={{ width: `${pct}%` }} /></div>
              </div>
              <div className="row" style={css({ '--gap': '4px', marginLeft: '-10px' })}>
                <Button variant="ghost" size="sm" icon={Eye} onClick={() => setViewing(n)}>Read receipts</Button>
                {n.state === 'active' && <Button variant="ghost" size="sm" icon={Ban} style={{ color: 'var(--danger)' }} onClick={() => setWithdrawing(n)}>Withdraw</Button>}
              </div>
            </article>
          );
        })}

      {composing && <ComposeSheet onClose={() => setComposing(false)} />}
      {viewing && <ReceiptsSheet n={viewing} onClose={() => setViewing(null)} />}
      {withdrawing && <WithdrawSheet n={withdrawing} onClose={() => setWithdrawing(null)} />}
    </div>
  );
}

function ComposeSheet({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const { banner, fail } = useFeedback();
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [priority, setPriority] = useState<(typeof PRIORITIES)[number]>('Normal');
  const [aud, setAud] = useState<keyof typeof AUDIENCES>('Everyone');
  const [blocks, setBlocks] = useState<string[]>([]);
  const [sms, setSms] = useState(false);
  const [until, setUntil] = useState('');
  const [file, setFile] = useState<PickedFile | null>(null);
  const audience = AUDIENCES[aud];
  const preview = useQuery({
    queryKey: ['notices', 'audience', audience, blocks.join(',')],
    queryFn: () => api.get<{ blocks: string[]; count: number; residents: number; security: number }>(`/admin/notices/audience?audience=${audience}&blocks=${blocks.join(',')}`),
    placeholderData: p => p,
  });
  const count = preview.data?.count ?? 0;
  const send = useMutation({
    mutationFn: () => api.post<{ message: string }>('/admin/notices', {
      title, body, priority: priority.toLowerCase(), audience, blocks, sms, expiresOn: until || undefined,
      attachment: file ? { name: file.name, data: file.data } : undefined,
    }),
    onSuccess: r => { banner({ text: r.message, tone: 'info', source: 'Gatepass' }); qc.invalidateQueries({ queryKey: ['notices'] }); onClose(); },
    onError: fail,
  });
  const cant = title.trim().length < 3 || body.trim().length < 3 || (audience === 'blocks' && !blocks.length) || count === 0;
  const breakdown = preview.data ? [preview.data.residents && plural(preview.data.residents, 'resident'), preview.data.security && plural(preview.data.security, 'security staff', 'security staff')].filter(Boolean).join(' + ') : '';

  return (
    <Sheet title="Compose notice" sub="Delivered instantly in the app, with an optional SMS." onClose={onClose}
      actions={<>
        <Button variant="primary" size="lg" icon={Send} disabled={cant} loading={send.isPending} onClick={() => send.mutate()}>
          Send to {plural(count, 'person', 'people')}
        </Button>
        <Button size="lg" onClick={onClose}>Cancel</Button>
      </>}>
      <TextField label="Title" value={title} onChange={setTitle} placeholder="e.g. Water supply shutdown on Saturday" maxLength={100} autoFocus />
      <Field label="Message" hint={`${body.length}/2000`}>
        <textarea className="input" value={body} onChange={e => setBody(e.target.value.slice(0, 2000))} placeholder="What's happening, when, and what residents should do." rows={5} />
      </Field>
      <AttachmentPicker value={file} onChange={setFile} />
      <Field label="Priority" hint={priority === 'Urgent' ? 'Shows as a pinned alert and asks everyone to tap “I’ve read this”.' : priority === 'Important' ? 'Pinned on home screens until read.' : 'Appears on the notice board.'}>
        <Seg label="Priority" options={PRIORITIES} value={priority} onChange={setPriority} block />
      </Field>
      <Field label="Send to" hint={count ? `Reaches ${breakdown || plural(count, 'person', 'people')}.` : audience === 'blocks' ? 'Choose one or more blocks.' : 'Nobody matches yet.'}>
        <Chips options={Object.keys(AUDIENCES) as (keyof typeof AUDIENCES)[]} value={aud} onChange={setAud} />
      </Field>
      {audience === 'blocks' && (
        <div className="chips">
          {(preview.data?.blocks ?? []).map(b => (
            <button key={b} type="button" className="chip" aria-pressed={blocks.includes(b)}
              onClick={() => setBlocks(x => (x.includes(b) ? x.filter(y => y !== b) : [...x, b]))}>Block {b}</button>
          ))}
        </div>
      )}
      <TextField label="Show until (optional)" type="date" value={until} onChange={setUntil} min={isoDay()} max={addDays(isoDay(), 365)}
        hint="After this date the notice disappears from notice boards. Leave empty to keep it." />
      <div className="row" style={{ padding: '12px 14px', border: '1px solid var(--hairline)', borderRadius: 12 }}>
        <MessageSquareText size={18} style={{ color: 'var(--sky)' }} />
        <div className="grow stack" style={css({ '--gap': '0' })}>
          <span className="row-title" style={{ fontSize: 14 }}>Also send by SMS</span>
          <span className="row-sub">{sms ? `Sends ${plural(count, 'SMS', 'SMS')} — reaches people without the app open.` : 'Recommended for urgent notices.'}</span>
        </div>
        <Toggle label="Also send by SMS" on={sms} onChange={setSms} />
      </div>
    </Sheet>
  );
}

const FILTERS = ['All', 'Not read', 'Read', 'Acknowledged'] as const;

function ReceiptsSheet({ n, onClose }: { n: SentNotice; onClose: () => void }) {
  const q = useQuery({ queryKey: ['notices', 'receipts', n.id], queryFn: () => api.get<{ recipients: Receipt[] }>(`/admin/notices/${n.id}`) });
  const [f, setF] = useState<(typeof FILTERS)[number]>('All');
  const all = q.data?.recipients ?? [];
  const shown = all.filter(r => f === 'All' || (f === 'Not read' ? !r.readAt : f === 'Read' ? !!r.readAt : !!r.ackAt));
  return (
    <Sheet title={n.title} sub={`${n.audienceLabel} · sent ${n.sentAt}`} onClose={onClose}>
      <p className="notice-body" style={{ background: 'var(--sunken)', padding: 12, borderRadius: 12 }}>{n.body}</p>
      {n.attachment && <AttachmentView a={n.attachment} />}
      <Seg label="Filter" options={n.priority === 'urgent' ? FILTERS : FILTERS.slice(0, 3)} value={f} onChange={setF} block />
      {q.isLoading ? <Skeleton n={3} h={52} /> : shown.length === 0 ? <Empty title="Nobody here" /> : (
        <div className="list">
          {shown.map(r => (
            <div key={r.mobile} className="list-row" style={{ minHeight: 56 }}>
              <Avatar name={r.name} size={36} />
              <div className="grow stack" style={css({ '--gap': '0' })}>
                <span className="row-title ellipsis" style={{ fontSize: 14 }}>{r.name}</span>
                <span className="row-sub">{r.role === 'Security' ? 'Security' : r.units || 'Resident'} · <span className="num">{fmtMobile(r.mobile)}</span></span>
                {(r.ackAt || r.readAt) && <span className="micro">{r.ackAt ? `Acknowledged ${r.ackAt}` : `Read ${r.readAt}`}</span>}
              </div>
              {r.ackAt ? <Tag tone="positive">Acknowledged</Tag> : r.readAt ? <Tag tone="info" plain>Read</Tag> : <Tag tone="neutral" plain>Not read</Tag>}
            </div>
          ))}
        </div>
      )}
    </Sheet>
  );
}

function WithdrawSheet({ n, onClose }: { n: SentNotice; onClose: () => void }) {
  const qc = useQueryClient();
  const { toast, fail } = useFeedback();
  const m = useMutation({
    mutationFn: () => api.post<{ message: string }>(`/admin/notices/${n.id}/withdraw`),
    onSuccess: r => { toast(r.message); qc.invalidateQueries({ queryKey: ['notices'] }); onClose(); },
    onError: fail,
  });
  return (
    <Sheet title="Withdraw this notice?" sub={n.title} onClose={onClose}
      actions={<>
        <Button variant="danger" size="lg" icon={Ban} loading={m.isPending} onClick={() => m.mutate()}>Withdraw notice</Button>
        <Button size="lg" onClick={onClose}>Cancel</Button>
      </>}>
      <div className="notice plain"><span>It disappears from everyone's notice board right away. SMS already sent can't be recalled. Read receipts stay available here.</span></div>
    </Sheet>
  );
}
