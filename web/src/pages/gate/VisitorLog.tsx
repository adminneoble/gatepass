import { ArrowRight, ClipboardList, LogOut } from 'lucide-react';
import { Avatar, Button, Empty, SectionHead, Skeleton, VisitTag, css } from '../../ui';
import { useGateVisits, useVisitAction } from './data';
import StatStrip from './StatStrip';

export default function VisitorLog() {
  const q = useGateVisits();
  const act = useVisitAction();
  const visits = q.data?.visits ?? [];
  return (
    <main className="content shell-col" style={css({ '--col': '720px' })}>
      <StatStrip stats={q.data?.stats} />
      <SectionHead title="Today" count={visits.length} />
      {q.isLoading ? <Skeleton n={4} /> : visits.length === 0 ? <Empty icon={ClipboardList} title="No visitors yet today" /> : (
        <div className="list">
          {visits.map(v => (
            <div key={v.id} className="list-row row-top">
              <Avatar name={v.name} src={v.photoUrl} size={48} />
              <div className="grow stack" style={css({ '--gap': '4px' })}>
                <div className="row" style={css({ '--gap': '8px' })}>
                  <span className="row-title grow ellipsis">{v.name}</span>
                  <VisitTag status={v.status} />
                </div>
                <span className="row-sub">{v.unitId} · {v.purpose} · {v.via} · {v.time}{v.exitedAt ? ` → ${v.exitedAt}` : ''}</span>
                {v.status === 'approved' && <div><Button variant="primary" size="sm" icon={ArrowRight} onClick={() => act.mutate({ v, action: 'enter' })}>Allow in</Button></div>}
                {v.status === 'inside' && <div><Button size="sm" icon={LogOut} onClick={() => act.mutate({ v, action: 'exit' })}>Mark exit</Button></div>}
              </div>
            </div>
          ))}
        </div>
      )}
    </main>
  );
}
