import type { GateVisits } from './data';

/** Compact, information-only summary of today at the gate. Always adds up to the total. */
export default function StatStrip({ stats }: { stats?: GateVisits['stats'] }) {
  const items: [number | undefined, string, string][] = [
    [stats?.inside, 'inside', 'tone-indigo'],
    [stats?.atGate, 'at gate', 'tone-amber'],
    [stats?.exited, 'exited', 'tone-slate'],
    ...(stats?.denied ? [[stats.denied, 'turned away', 'tone-slate'] as [number, string, string]] : []),
  ];
  return (
    <div className="stat-strip" role="group" aria-label="Today at the gate">
      {items.map(([n, l, tone]) => (
        <span key={l} className={'stat-chip ' + tone}><strong className="num">{n ?? '–'}</strong> {l}</span>
      ))}
      <span className="stat-total"><strong className="num">{stats?.total ?? '–'}</strong> today</span>
    </div>
  );
}
