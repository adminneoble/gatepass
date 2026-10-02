import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, ExternalLink, MessageSquareText, Smartphone } from 'lucide-react';
import { api } from '../lib/api';
import { fmtMobile } from '../lib/format';
import { Empty, SectionHead, css } from '../ui';

type Inbox = { sender: string; threads: { to_mobile: string; n: number; last: string }[]; messages: { id: number; body: string; link: string | null; at: string }[] };

/**
 * Development-only SMS inbox. Visitors have no app — in production they get a real SMS.
 * Here every outgoing SMS lands in an outbox so you can play the visitor.
 */
export default function DevSms() {
  const [mobile, setMobile] = useState('');
  const q = useQuery({ queryKey: ['sms', mobile], queryFn: () => api.get<Inbox>('/dev/sms?mobile=' + mobile), refetchInterval: 2000 });
  const d = q.data;
  const time = (iso: string) => new Date(iso).toLocaleString('en-GB', { hour: '2-digit', minute: '2-digit', day: 'numeric', month: 'short' });

  return (
    <div className="shell" style={css({ '--col': '980px' })}>
      <header className="app-header">
        <div className="app-header-inner shell-col">
          <div className="logo-tile"><Smartphone size={20} /></div>
          <div className="titles"><span className="kicker">Development · visitor phone</span><h1 className="title">SMS inbox</h1></div>
          <Link className="btn btn-ghost" to="/login"><ArrowLeft size={18} />Sign in</Link>
        </div>
      </header>
      <div className="content shell-col" style={{ paddingBottom: 48 }}>
        <p className="meta">Visitors don't install an app. Every SMS Gatepass sends lands here in development so you can open pass links and read OTPs. Plug a DLT-registered SMS gateway into <code>server/src/lib/sms.ts</code> for production.</p>
        <div className="dev-grid">
          <div className="stack" style={css({ '--gap': '8px' })}>
            <SectionHead title="Numbers" count={d?.threads.length} />
            <div className="list">
              {d?.threads.map(t => (
                <button key={t.to_mobile} className="list-row interactive" onClick={() => setMobile(t.to_mobile)}
                  style={{ background: mobile === t.to_mobile ? 'var(--sunken)' : undefined, minHeight: 56 }}>
                  <span className="grow stack" style={css({ '--gap': '0' })}>
                    <span className="row-title num">{fmtMobile(t.to_mobile)}</span>
                    <span className="row-sub">{t.n} message{t.n === 1 ? '' : 's'} · {time(t.last)}</span>
                  </span>
                </button>
              ))}
            </div>
          </div>
          <div className="stack" style={css({ '--gap': '8px' })}>
            <SectionHead title={mobile ? `${d?.sender ?? 'SMS'} → ${fmtMobile(mobile)}` : 'Messages'} />
            {!mobile && <Empty icon={MessageSquareText} title="Pick a number">Choose a recipient on the left to read their messages.</Empty>}
            {d?.messages.map(m => (
              <div key={m.id} className="bubble stack" style={css({ '--gap': '6px' })}>
                <span>{m.body}</span>
                {m.link && <a href={m.link.replace(/^https?:\/\/[^/]+/, '')} target="_blank" rel="noreferrer" className="row" style={css({ '--gap': '6px' })}><ExternalLink size={14} />{m.link.replace(/^https?:\/\//, '')}</a>}
                <span className="micro">{time(m.at)}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
