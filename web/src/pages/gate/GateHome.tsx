import { useNavigate } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import { ArrowRight, DoorOpen, LogOut, Phone, ScanLine, Siren, UserPlus, Users } from 'lucide-react';
import StatStrip from './StatStrip';
import { PinnedNotices } from '../shared/Notices';
import { api } from '../../lib/api';
import { useFeedback } from '../../lib/feedback';
import { useMe } from '../../lib/session';
import { fmtMobile, tel } from '../../lib/format';
import type { GateAlert } from '../../lib/types';
import { Avatar, Button, Empty, SectionHead, Skeleton, Tag, css } from '../../ui';
import { useGateVisits, useOpenAlerts, useVisitAction } from './data';

export default function GateHome() {
  const nav = useNavigate();
  const me = useMe().data?.user;
  const q = useGateVisits();
  const alerts = useOpenAlerts().data ?? [];
  const act = useVisitAction();
  const visits = q.data?.visits ?? [];
  const waiting = visits.filter(v => v.status === 'pending' || v.status === 'approved');
  const inside = visits.filter(v => v.status === 'inside');

  return (
    <main className="content shell-col home-grid">
      <div className="span stack">
        <div className="duty"><span className="live" />On duty · {me?.name}</div>
        {alerts.map(a => <AlertCard key={a.id} a={a} />)}
        <PinnedNotices to="/gate/notices" />
      </div>

      <div className="stack">
        <div className="tiles">
          <button className="tile primary" onClick={() => nav('/gate/entry')}>
            <UserPlus size={28} strokeWidth={2} />
            <span className="stack" style={css({ '--gap': '2px' })}>New visitor<span className="tile-sub">Log a walk-in</span></span>
          </button>
          <button className="tile" onClick={() => nav('/gate/verify')}>
            <ScanLine size={28} strokeWidth={2} />
            <span className="stack" style={css({ '--gap': '2px' })}>Verify code or QR<span className="tile-sub">Pre-approved guests</span></span>
          </button>
        </div>
        <StatStrip stats={q.data?.stats} />
      </div>

      <div className="stack">
        <SectionHead title="At the gate" count={waiting.length} />
        {q.isLoading ? <Skeleton /> : waiting.length === 0 ? <Empty icon={DoorOpen} title="No one is waiting">New walk-ins appear here until the resident responds.</Empty> : (
          <div className="list">
            {waiting.map(v => (
              <div key={v.id} className="list-row">
                <Avatar name={v.name} src={v.photoUrl} />
                <div className="grow stack" style={css({ '--gap': '2px' })}>
                  <span className="row-title ellipsis">{v.name}</span>
                  <span className="row-sub">{v.unitId} · {v.purpose} · {v.time}</span>
                </div>
                {v.status === 'approved'
                  ? <Button variant="primary" icon={ArrowRight} loading={act.isPending && act.variables?.v.id === v.id} onClick={() => act.mutate({ v, action: 'enter' })}>Allow in</Button>
                  : <Tag tone="pending">Awaiting</Tag>}
              </div>
            ))}
          </div>
        )}

        <SectionHead title="Inside now" count={inside.length} />
        {q.isLoading ? <Skeleton /> : inside.length === 0 ? <Empty icon={Users} title="No visitors inside" /> : (
          <div className="list">
            {inside.map(v => (
              <div key={v.id} className="list-row">
                <Avatar name={v.name} src={v.photoUrl} />
                <div className="grow stack" style={css({ '--gap': '2px' })}>
                  <span className="row-title ellipsis">{v.name}</span>
                  <span className="row-sub">{v.unitId} · in at {v.enteredAt ?? v.time} · {v.via}</span>
                </div>
                <Button icon={LogOut} loading={act.isPending && act.variables?.v.id === v.id} onClick={() => act.mutate({ v, action: 'exit' })}>Mark exit</Button>
              </div>
            ))}
          </div>
        )}
      </div>
    </main>
  );
}

function AlertCard({ a }: { a: GateAlert }) {
  const { toast, fail } = useFeedback();
  const m = useMutation({
    mutationFn: (action: 'ack' | 'resolve') => api.post(`/alerts/${a.id}/${action}`),
    onSuccess: (_d, action) => toast(action === 'ack' ? 'Resident told you are responding' : 'Alert resolved'),
    onError: fail,
  });
  const isNew = a.status === 'new';
  return (
    <section className={'alert-card' + (isNew ? '' : ' ack')} aria-live="assertive">
      <div className="row alert-head" style={css({ '--gap': '8px' })}>
        <Siren size={16} />
        <span className="kicker grow" style={{ color: 'inherit' }}>Resident alert · {a.time}</span>
        {isNew ? <Tag tone="danger">New</Tag> : <Tag tone="info">Responding</Tag>}
      </div>
      <span className="alert-type">{a.type}</span>
      <span className="alert-meta">{a.unitId} · {a.name} · <span className="num">{fmtMobile(a.mobile)}</span></span>
      {a.note && <span style={{ fontSize: 14 }}>“{a.note}”</span>}
      <div className="row" style={css({ '--gap': '8px', marginTop: '6px' })}>
        <a className="btn btn-secondary" href={tel(a.mobile)}><Phone size={18} />Call</a>
        {isNew
          ? <Button variant="primary" loading={m.isPending} onClick={() => m.mutate('ack')}>Acknowledge</Button>
          : <Button variant="primary" loading={m.isPending} onClick={() => m.mutate('resolve')}>Mark resolved</Button>}
      </div>
    </section>
  );
}
