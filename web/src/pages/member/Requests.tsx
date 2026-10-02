import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Check, DoorClosed, Phone, ShieldCheck, Siren, X } from 'lucide-react';
import { api } from '../../lib/api';
import { useFeedback } from '../../lib/feedback';
import { useSociety } from '../../lib/session';
import { fmtMobile, tel } from '../../lib/format';
import type { MyAlert, Visit } from '../../lib/types';
import { Avatar, Button, Empty, SectionHead, Skeleton, Tag, VisitTag, css } from '../../ui';
import { usePendingRequests, useUnit } from './context';
import { ExtendSheet, type ExtendTarget } from './sheets';
import { PinnedNotices } from '../shared/Notices';

export default function Requests() {
  const { unit, openSecurity } = useUnit();
  const society = useSociety().data;
  const pending = usePendingRequests();
  const alerts = useQuery({ queryKey: ['alerts', 'mine'], queryFn: () => api.get<MyAlert[]>('/me/alerts') }).data ?? [];
  const history = useQuery({ queryKey: ['visits', 'unit', unit.id], queryFn: () => api.get<Visit[]>(`/me/units/${unit.id}/visits`) });
  const [ext, setExt] = useState<ExtendTarget | null>(null);

  return (
    <main className="content shell-col">
      <PinnedNotices to="/app/notices" />
      {alerts.map(a => (
        <div key={a.id} className={'alert-card' + (a.status === 'ack' ? ' ack' : '')} style={{ padding: '12px 14px' }}>
          <div className="row" style={css({ '--gap': '10px' })}>
            <Siren size={18} style={{ color: a.status === "new" ? "var(--danger)" : "var(--ink-3)" }} />
            <div className="grow stack" style={css({ '--gap': '0' })}>
              <span className="strong alert-head">{a.type} · {a.time}</span>
              <span className="alert-meta">{a.status === 'new' ? 'Sent · waiting for security' : 'Security is responding'}</span>
            </div>
          </div>
        </div>
      ))}

      <section className="card" style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <div className="icon-tile toned tone-sky"><ShieldCheck size={20} /></div>
        <div className="grow stack" style={css({ '--gap': '0' })}>
          <span className="kicker">Security · 24×7</span>
          <span className="row-title">Main gate</span>
          <span className="row-sub num" style={{ whiteSpace: 'nowrap' }}>{society ? fmtMobile(society.gatePhone) : '…'}</span>
        </div>
        {society && <a className="btn btn-secondary btn-icon" href={tel(society.gatePhone)} aria-label="Call security"><Phone size={18} /></a>}
        <Button variant="danger" icon={Siren} onClick={openSecurity}>Alert</Button>
      </section>

      <SectionHead title="Waiting at the gate" count={pending.data?.length} />
      {pending.isLoading ? <Skeleton h={160} n={1} /> : !pending.data?.length
        ? <Empty icon={DoorClosed} title="No one is waiting">You'll be notified when security logs a visitor for your units.</Empty>
        : pending.data.map(v => <PendingCard key={v.id} v={v} />)}

      <SectionHead title={`Today at ${unit.id}`} count={history.data?.length} />
      {history.isLoading ? <Skeleton /> : !history.data?.length ? <Empty title="No visitors yet today" /> : (
        <div className="list">
          {history.data.map(v => (
            <div key={v.id} className="list-row">
              <Avatar name={v.name} src={v.photoUrl} size={40} />
              <div className="grow stack" style={css({ '--gap': '2px' })}>
                <span className="row-title ellipsis">{v.name}</span>
                <span className="row-sub">{v.purpose} · {v.via} · {v.time}</span>
              </div>
              {v.status !== 'denied' && <Button variant="ghost" size="sm" onClick={() => setExt({ name: v.name, mobile: v.mobile, purpose: v.purpose, visitId: v.id })}>Extend</Button>}
              <VisitTag status={v.status} />
            </div>
          ))}
        </div>
      )}
      {ext && <ExtendSheet target={ext} onClose={() => setExt(null)} />}
    </main>
  );
}

function PendingCard({ v }: { v: Visit }) {
  const { toast, fail } = useFeedback();
  const m = useMutation({
    mutationFn: (decision: 'approved' | 'denied') => api.post(`/visits/${v.id}/decision`, { decision }),
    onSuccess: (_d, decision) => toast(decision === 'approved' ? `${v.name} approved. Security will let them in.` : `${v.name} denied`),
    onError: fail,
  });
  return (
    <section className="card accent" style={{ boxShadow: 'var(--shadow-md)', animation: 'pop 240ms var(--ease)', paddingTop: 20 }}>
      <div className="card-head">
        <span className="kicker grow">At the gate · {v.unitId} · {v.time}</span>
        <Tag tone="pending">Waiting</Tag>
      </div>
      <div className="row" style={css({ '--gap': '14px' })}>
        <Avatar name={v.name} src={v.photoUrl} size={72} />
        <div className="grow stack" style={css({ '--gap': '2px' })}>
          <span className="title">{v.name}</span>
          <span className="meta">{v.purpose} · {v.via}</span>
          <a className="meta num" href={tel(v.mobile)}>{fmtMobile(v.mobile)}</a>
        </div>
      </div>
      <div className="grid-2" style={css({ '--gap': '8px' })}>
        <Button variant="primary" size="lg" icon={Check} loading={m.isPending && m.variables === 'approved'} disabled={m.isPending} onClick={() => m.mutate('approved')}>Approve</Button>
        <Button size="lg" icon={X} loading={m.isPending && m.variables === 'denied'} disabled={m.isPending} onClick={() => m.mutate('denied')}>Deny</Button>
      </div>
    </section>
  );
}
