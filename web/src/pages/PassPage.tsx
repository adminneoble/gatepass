import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { CalendarClock, Home, Lock, Tag as TagIcon } from 'lucide-react';
import { api } from '../lib/api';
import type { Brand, PassState } from '../lib/types';
import { Empty, LogoTile, QR, Skeleton, css } from '../ui';

type PublicPass = { society: Brand; pass: { name: string; code: string; unitId: string; purpose: string; validLabel: string; state: PassState; token: string } };

const STATE: Record<PassState, string> = { valid: 'Valid', used: 'Used', expired: 'Expired', upcoming: 'Not yet valid', revoked: 'Revoked' };

/** Visitor-facing pass opened from the SMS link. No app, no sign-in. */
export default function PassPage() {
  const { token = '' } = useParams();
  const q = useQuery({ queryKey: ['pass', token], queryFn: () => api.get<PublicPass>('/p/' + token), refetchInterval: 30_000 });
  const p = q.data?.pass;
  const live = p?.state === 'valid';

  return (
    <div className="pass-page">
      <div className="row micro" style={css({ '--gap': '6px', alignSelf: 'center' })}><Lock size={12} /> Secure entry pass</div>
      {q.isLoading && <div style={{ width: '100%', maxWidth: 380 }}><Skeleton h={480} n={1} /></div>}
      {q.isError && <div style={{ width: '100%', maxWidth: 380 }}><Empty title="Pass not found">This link is not valid. Ask your host to share the pass again.</Empty></div>}
      {p && q.data && (
        <article className="ticket">
          <div className="ticket-band">
            <LogoTile brand={q.data.society} size={36} />
            <span className="grow title-sm ellipsis">{q.data.society.name}</span>
            <span className="tag band-tag">{STATE[p.state]}</span>
          </div>
          <div className="ticket-body">
            <div className="stack" style={css({ '--gap': '4px' })}>
              <span className="kicker">Entry pass for</span>
              <h1 className="title-lg">{p.name}</h1>
            </div>
            <QR value={p.token} size={240} dim={!live} />
            <div className="stack" style={css({ '--gap': '6px', alignItems: 'center' })}>
              <span className="kicker">Entry code</span>
              <span className="code-display" style={!live ? { color: 'var(--ink-3)', textDecoration: p.state === 'used' || p.state === 'revoked' ? 'line-through' : undefined } : undefined}>{p.code}</span>
            </div>
          </div>
          <div className="ticket-perf" />
          <div className="ticket-facts">
            <div className="stack" style={css({ '--gap': '2px' })}><span className="k"><Home size={11} />Visiting</span><span className="v">{p.unitId}</span></div>
            <div className="stack" style={css({ '--gap': '2px' })}><span className="k"><TagIcon size={11} />Purpose</span><span className="v">{p.purpose}</span></div>
            <div className="stack" style={css({ '--gap': '2px' })}><span className="k"><CalendarClock size={11} />Validity</span><span className="v">{p.validLabel}</span></div>
          </div>
        </article>
      )}
      {p && (
        <p className="meta" style={{ maxWidth: 340, textAlign: 'center' }}>
          {live ? 'Show the QR at the gate reader or tell security the code.' : p.state === 'revoked' ? 'Your host cancelled this pass. Contact them if you still plan to visit.' : p.state === 'used' ? 'This pass has been used. Ask your host for a new one if you need to visit again.' : p.state === 'upcoming' ? 'This pass becomes valid on the date shown.' : 'This pass has expired. Ask your host to extend it.'}
        </p>
      )}
    </div>
  );
}
