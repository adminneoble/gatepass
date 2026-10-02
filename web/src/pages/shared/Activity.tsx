import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ArrowRight, Bell, Building2, Check, ChevronRight, Clock, History, Info, LogIn, LogOut, Ticket, TicketX, User, UserPlus, X, type LucideIcon } from 'lucide-react';
import { api } from '../../lib/api';
import { addDays, dayLabel, fmtMobile, isoDay, plural } from '../../lib/format';
import type { ActivityItem, EventKind } from '../../lib/types';
import { Avatar, Empty, Seg, Sheet, Skeleton, Tag, TextField, css } from '../../ui';

const KIND: Record<EventKind, [string, LucideIcon, string?]> = {
  request: ['At the gate, awaiting approval', UserPlus, 'toned tone-amber'], approved: ['Approved by resident', Check, 'ok'], denied: ['Denied by resident', X, 'muted'],
  entry: ['Entered', LogIn, 'ok'], exit: ['Exited', LogOut, 'toned tone-slate'], pass: ['Pass issued', Ticket, 'toned tone-violet'], extend: ['Approval extended', Clock, 'toned tone-sky'],
  alert: ['Alert to security', Bell, 'danger'], revoke: ['Pass revoked', TicketX, 'muted'], tenant: ['Member directory change', Building2, 'toned tone-indigo'], profile: ['Profile update', User, 'toned tone-indigo'],
};
const RANGES = ['Today', '7 days', '30 days', 'Custom'] as const;

/** Activity log with range control, grouped by day. Member passes a unit; admin sees all units. */
/** `detailed` (admin): rows open the full audit record. */
export default function Activity({ unit, detailed }: { unit?: string; detailed?: boolean }) {
  const [open, setOpen] = useState<ActivityItem | null>(null);
  const today = isoDay();
  const [range, setRange] = useState<(typeof RANGES)[number]>('7 days');
  const [cFrom, setCFrom] = useState(addDays(today, -6));
  const [cTo, setCTo] = useState(today);
  let [from, to] = range === 'Today' ? [today, today] : range === '7 days' ? [addDays(today, -6), today] : range === '30 days' ? [addDays(today, -29), today] : [cFrom, cTo];
  if (from > to) [from, to] = [to, from];

  const q = useQuery({
    queryKey: ['events', unit ?? 'all', from, to],
    queryFn: () => api.get<{ items: ActivityItem[] }>(`/activity?from=${from}&to=${to}${unit ? '&unit=' + unit : ''}`),
    placeholderData: p => p,
  });
  const items = q.data?.items ?? [];
  const days: { day: string; items: ActivityItem[] }[] = [];
  for (const e of items) {
    const last = days[days.length - 1];
    if (last?.day === e.day) last.items.push(e); else days.push({ day: e.day, items: [e] });
  }

  return (
    <div className="stack">
      <Seg label="Date range" options={RANGES} value={range} onChange={setRange} block />
      {range === 'Custom' && (
        <div className="grid-2">
          <TextField label="From" type="date" value={cFrom} max={cTo} onChange={setCFrom} />
          <TextField label="To" type="date" value={cTo} min={cFrom} max={today} onChange={setCTo} />
        </div>
      )}
      <div className="row between">
        <span className="meta"><strong style={{ color: 'var(--ink)' }}>{plural(items.length, 'activity', 'activities')}</strong> · {from === to ? dayLabel(from) : `${dayLabel(from)} – ${dayLabel(to)}`}</span>
      </div>
      {q.isLoading ? <Skeleton n={5} h={56} /> : items.length === 0 ? <Empty icon={History} title="No activity in this range" /> : days.map(d => (
        <section key={d.day} className="day-group">
          <h3 className="day-label">{d.day === today ? 'Today · ' + dayLabel(d.day) : dayLabel(d.day)}</h3>
          <div className="list">
            {d.items.map(e => {
              const [label, Icon, tone] = KIND[e.kind];
              return (
                <Row key={e.id} onClick={detailed ? () => setOpen(e) : undefined}>
                  <div className={'icon-tile' + (tone ? ' ' + tone : '')}><Icon size={16} /></div>
                  <div className="grow stack" style={css({ '--gap': '1px' })}>
                    <span className="row-title ellipsis" style={{ fontSize: 14 }}>{e.name}</span>
                    <span className="row-sub">{[!unit && e.unitId, label, e.detail].filter(Boolean).join(' · ')}</span>
                  </div>
                  <span className="micro num">{e.time}</span>
                  {detailed && <ChevronRight size={16} style={{ color: 'var(--ink-4)', flex: 'none' }} />}
                </Row>
              );
            })}
          </div>
        </section>
      ))}
      {open && <EventSheet e={open} onClose={() => setOpen(null)} />}
    </div>
  );
}

function Row({ onClick, children }: { onClick?: () => void; children: React.ReactNode }) {
  return onClick
    ? <button type="button" className="list-row interactive" style={{ minHeight: 56 }} onClick={onClick}>{children}</button>
    : <div className="list-row" style={{ minHeight: 56 }}>{children}</div>;
}

/** Full audit record for one activity (admin). */
function EventSheet({ e, onClose }: { e: ActivityItem; onClose: () => void }) {
  const [label, Icon, tone] = KIND[e.kind];
  const fields = e.fields ?? [], changes = e.changes ?? [];
  return (
    <Sheet title={label} sub={<span className="num">{e.stamp ?? `${dayLabel(e.day)}, ${e.time}`}</span>} onClose={onClose}>
      <div className="row" style={css({ '--gap': '12px' })}>
        <div className={'icon-tile' + (tone ? ' ' + tone : '')} style={{ width: 44, height: 44 }}><Icon size={20} /></div>
        <div className="grow stack" style={css({ '--gap': '2px' })}>
          <span className="title-sm">{e.name}</span>
          <span className="meta">{[e.unitId, e.detail].filter(Boolean).join(' · ')}</span>
        </div>
      </div>

      <div className="stack" style={css({ '--gap': '8px' })}>
        <span className="field-label">Performed by</span>
        {e.actor ? (
          <div className="row" style={css({ '--gap': '12px', padding: '10px 12px', background: 'var(--sunken)', borderRadius: '12px', border: '1px solid var(--hairline)' })}>
            <Avatar name={e.actor.name} size={38} />
            <div className="grow stack" style={css({ '--gap': '0' })}>
              <span className="row-title" style={{ fontSize: 14 }}>{e.actor.name}</span>
              {e.actor.mobile && <span className="row-sub num">{fmtMobile(e.actor.mobile)}</span>}
            </div>
            {e.actor.role && <Tag tone="info" plain>{e.actor.role}</Tag>}
          </div>
        ) : <span className="meta">Not recorded.</span>}
      </div>

      {fields.length > 0 && (
        <div className="stack" style={css({ '--gap': '8px' })}>
          <span className="field-label">Details</span>
          <dl className="kv">
            {fields.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}
          </dl>
        </div>
      )}

      {changes.length > 0 && (
        <div className="stack" style={css({ '--gap': '8px' })}>
          <span className="field-label">Changes</span>
          <div className="list">
            {changes.map(c => (
              <div key={c.field} className="list-row" style={{ minHeight: 0, flexDirection: 'column', alignItems: 'stretch', gap: 4 }}>
                <span className="kicker">{c.field}</span>
                <div className="row wrap" style={css({ '--gap': '8px' })}>
                  <span className="muted" style={{ textDecoration: c.from === '—' ? undefined : 'line-through' }}>{c.from === '—' ? 'None' : c.from}</span>
                  <ArrowRight size={14} style={{ color: 'var(--ink-4)' }} />
                  <strong style={{ color: 'var(--indigo)' }}>{c.to === '—' ? 'None' : c.to}</strong>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {!e.actor && fields.length === 0 && changes.length === 0 && (
        <div className="notice plain"><Info size={16} /><span>This entry was recorded before full audit details were captured, so only the summary is available.</span></div>
      )}
    </Sheet>
  );
}
