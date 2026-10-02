import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BellOff, CalendarCheck, Phone, Siren } from 'lucide-react';
import { api } from '../../lib/api';
import { useFeedback } from '../../lib/feedback';
import { useSociety } from '../../lib/session';
import { addDays, dayLabel, fmtMobile, isoDay, tel } from '../../lib/format';
import { ALERT_TYPES, type Notification } from '../../lib/types';
import { Button, Chips, Empty, Field, Seg, Sheet, TextField, css } from '../../ui';
import { useUnit } from './context';

// ── Contact security ────────────────────────────────────────────────────────

export function ContactSecuritySheet({ onClose }: { onClose: () => void }) {
  const s = useSociety().data;
  const { unit } = useUnit();
  const { banner, fail } = useFeedback();
  const [type, setType] = useState<(typeof ALERT_TYPES)[number] | ''>('');
  const [note, setNote] = useState('');
  const send = useMutation({
    mutationFn: () => api.post('/alerts', { unitId: unit.id, type, note }),
    onSuccess: () => { banner({ text: 'Alert sent. Security can see your unit and phone number.', tone: 'info', source: 'Gatepass' }); onClose(); },
    onError: fail,
  });
  const contacts = s ? [
    { label: 'Main gate · 24×7', name: 'Gate desk', phone: s.gatePhone },
    { label: 'Security supervisor', name: s.supervisorName, phone: s.supervisorPhone },
  ] : [];

  return (
    <Sheet title="Contact security" onClose={onClose}
      actions={<>
        <Button variant="danger" size="lg" icon={Siren} disabled={!type} loading={send.isPending} onClick={() => send.mutate()}>Send alert</Button>
        <Button size="lg" onClick={onClose}>Cancel</Button>
      </>}>
      <div className="list">
        {contacts.map(c => (
          <div key={c.label} className="list-row">
            <div className="grow stack" style={css({ '--gap': '1px' })}>
              <span className="kicker">{c.label}</span>
              <span className="row-title">{c.name}</span>
              <span className="row-sub num">{fmtMobile(c.phone)}</span>
            </div>
            <a className="btn btn-primary" href={tel(c.phone)}><Phone size={18} />Call</a>
          </div>
        ))}
      </div>
      <Field label="Or send an alert to the gate">
        <Chips options={ALERT_TYPES} value={type} onChange={setType} grid danger />
      </Field>
      <TextField label="Note (optional)" value={note} onChange={setNote} placeholder="e.g. Father has fallen, need help" maxLength={280} />
      <span className="micro">Security sees your name, unit {unit.id} and phone number.</span>
    </Sheet>
  );
}

// ── Extend approval ─────────────────────────────────────────────────────────

export type ExtendTarget = { name: string; mobile: string; purpose: string; passId?: number; visitId?: number };
const DURS = ['1 day', '3 days', '1 week', 'Custom'] as const;
const DAYS: Record<string, number> = { '1 day': 1, '3 days': 3, '1 week': 7 };

export function ExtendSheet({ target, onClose }: { target: ExtendTarget; onClose: () => void }) {
  const { banner, fail } = useFeedback();
  const [dur, setDur] = useState<(typeof DURS)[number]>('3 days');
  const today = isoDay();
  const [custom, setCustom] = useState(addDays(today, 3));
  const until = dur === 'Custom' ? custom : addDays(today, DAYS[dur]);
  const m = useMutation({
    mutationFn: () => api.post<{ message: string }>('/passes/extend', { passId: target.passId, visitId: target.visitId, until }),
    onSuccess: r => { banner({ text: r.message, tone: 'info', source: 'Gatepass' }); onClose(); },
    onError: fail,
  });
  return (
    <Sheet title="Extend approval" sub={<><strong style={{ color: 'var(--ink)' }}>{target.name}</strong> · {target.purpose} · <span className="num">{fmtMobile(target.mobile)}</span></>} onClose={onClose}
      actions={<>
        <Button variant="primary" size="lg" icon={CalendarCheck} disabled={!until || until < today} loading={m.isPending} onClick={() => m.mutate()}>Extend approval</Button>
        <Button size="lg" onClick={onClose}>Cancel</Button>
      </>}>
      <Field label="Extend for"><Seg label="Extend for" options={DURS} value={dur} onChange={setDur} block /></Field>
      {dur === 'Custom' && <TextField label="Valid until" type="date" value={custom} onChange={setCustom} min={today} max={addDays(today, 90)} />}
      <div className="notice">
        <span>Valid until <strong>{until ? dayLabel(until) : '—'}</strong>. The same code keeps working for repeat entries.</span>
      </div>
    </Sheet>
  );
}

// ── Notifications ───────────────────────────────────────────────────────────

export const useNotifications = () => useQuery({
  queryKey: ['notifications'], queryFn: () => api.get<{ unread: number; items: Notification[] }>('/me/notifications'),
});

export function NotificationsSheet({ onClose }: { onClose: () => void }) {
  const q = useNotifications();
  const qc = useQueryClient();
  const nav = useNavigate();
  const unread = q.data?.unread ?? 0;
  useEffect(() => {
    if (unread) api.post('/me/notifications/read').then(() => qc.invalidateQueries({ queryKey: ['notifications'] }));
  }, [unread, qc]);
  const items = q.data?.items ?? [];
  const today = isoDay();
  return (
    <Sheet title="Notifications" onClose={onClose}>
      {items.length === 0 ? <Empty icon={BellOff} title="You're all caught up" /> : (
        <div className="list">
          {items.map(n => (
            <button key={n.id} className="list-row interactive" style={{ background: n.read ? undefined : 'var(--sunken)', alignItems: 'flex-start' }}
              onClick={() => { if (n.link) { onClose(); nav(n.link); } }}>
              <span style={{ width: 8, height: 8, marginTop: 7, flex: 'none', borderRadius: '50%', background: n.read ? 'transparent' : 'var(--primary)' }} />
              <span className="grow stack" style={css({ '--gap': '2px' })}>
                <span style={{ fontSize: 14, fontWeight: n.read ? 400 : 600 }}>{n.text}</span>
                <span className="micro">{n.day === today ? 'Today' : dayLabel(n.day)} · {n.time}</span>
              </span>
            </button>
          ))}
        </div>
      )}
    </Sheet>
  );
}
