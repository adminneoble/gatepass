import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowRight, MessageSquareText, ShieldCheck } from 'lucide-react';
import { api, ApiError } from '../lib/api';
import { homeFor, useMe } from '../lib/session';
import { fmtMobile } from '../lib/format';
import type { User } from '../lib/types';
import { Button, CodeInput, LogoTile, MobileField, Notice, css } from '../ui';

const DEMO = [
  ['Security · Gate desk', '9800012345'],
  ['Resident · Ananya Rao (owner B-402, C-110)', '9811100001'],
  ['Resident · Mister Tenant (tenant C-110)', '9876987698'],
  ['Admin · Kavita Desai', '9800000001'],
] as const;

export default function Login() {
  const me = useMe();
  const qc = useQueryClient();
  const nav = useNavigate();
  const [mobile, setMobile] = useState('');
  const [step, setStep] = useState<'mobile' | 'code'>('mobile');
  const [code, setCode] = useState('');
  const [devCode, setDevCode] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [wait, setWait] = useState(0);

  useEffect(() => { if (me.data?.user) nav(homeFor(me.data.user.roles), { replace: true }); }, [me.data, nav]);
  useEffect(() => { if (wait <= 0) return; const t = setTimeout(() => setWait(w => w - 1), 1000); return () => clearTimeout(t); }, [wait]);

  const send = async () => {
    setBusy(true); setError(null);
    try {
      const r = await api.post<{ devCode?: string }>('/auth/otp', { mobile });
      setDevCode(r.devCode ?? null); setStep('code'); setCode(''); setWait(20);
    } catch (e) { setError(e instanceof ApiError ? e.message : 'Could not send the code.'); }
    setBusy(false);
  };
  const verify = async (c = code) => {
    setBusy(true); setError(null);
    try {
      const r = await api.post<{ user: User }>('/auth/verify', { mobile, code: c });
      await qc.invalidateQueries({ queryKey: ['me'] });
      nav(homeFor(r.user.roles), { replace: true });
    } catch (e) { setError(e instanceof ApiError ? e.message : 'Could not verify.'); setBusy(false); }
  };

  const brand = me.data?.society;
  return (
    <div className="login">
      <aside className="login-art" aria-hidden>
        <div className="grid-bg" />
        <div className="row" style={css({ '--gap': '12px', position: 'relative' })}>
          <LogoTile brand={brand ? { ...brand, logo: brand.logo } : undefined} size={44} />
          <span className="title-sm">{brand?.name}</span>
        </div>
        <div className="stack" style={css({ '--gap': '20px', position: 'relative' })}>
          <span className="big">Every visitor,<br />accounted for.</span>
          <span style={{ maxWidth: 420, opacity: 0.75 }}>Walk-ins approved from your phone. Guests pre-approved with a code and QR. One tap to reach the gate.</span>
        </div>
        <span className="kicker" style={{ color: 'inherit', opacity: 0.6, position: 'relative' }}>Gatepass · Society visitor management</span>
      </aside>

      <main className="login-main">
        <div className="login-card">
          <div className="stack" style={css({ '--gap': '14px' })}>
            <LogoTile brand={brand} size={56} />
            <div className="stack" style={css({ '--gap': '6px' })}>
              <span className="kicker">{brand?.name ?? 'Gatepass'}</span>
              <h1 className="title-lg">{step === 'mobile' ? 'Sign in to Gatepass' : 'Enter the code'}</h1>
              <p className="meta">
                {step === 'mobile' ? 'Use the mobile number registered with your society.' : <>We sent a 4-digit code to <strong className="num">{fmtMobile(mobile)}</strong>.</>}
              </p>
            </div>
          </div>

          {step === 'mobile' ? (
            <form className="stack" onSubmit={e => { e.preventDefault(); if (mobile.length === 10) send(); }}>
              <MobileField value={mobile} onChange={v => { setMobile(v); setError(null); }} autoFocus error={error} />
              <Button variant="primary" size="lg" block type="submit" disabled={mobile.length !== 10} loading={busy} trail={<ArrowRight size={18} />}>Send code</Button>
            </form>
          ) : (
            <form className="stack" onSubmit={e => { e.preventDefault(); if (code.length === 4) verify(); }}>
              <CodeInput length={4} label="Sign-in code" value={code} autoFocus state={error ? 'error' : undefined}
                onChange={v => { setCode(v); setError(null); if (v.length === 4) verify(v); }} />
              {error && <Notice tone="danger">{error}</Notice>}
              {devCode && <Notice icon={MessageSquareText}>Demo mode: your code is <strong className="num">{devCode}</strong>.</Notice>}
              <Button variant="primary" size="lg" block type="submit" disabled={code.length !== 4} loading={busy} icon={ShieldCheck}>Verify and sign in</Button>
              <div className="row between">
                <Button variant="ghost" size="sm" type="button" onClick={() => { setStep('mobile'); setError(null); }}>Change number</Button>
                <Button variant="ghost" size="sm" type="button" disabled={wait > 0 || busy} onClick={send}>{wait > 0 ? `Resend in ${wait}s` : 'Resend code'}</Button>
              </div>
            </form>
          )}

          {me.data?.demo && step === 'mobile' && (
            <div className="stack" style={css({ '--gap': '8px' })}>
              <span className="kicker">Demo accounts</span>
              <div className="list">
                {DEMO.map(([label, m]) => (
                  <button key={m} className="list-row interactive" style={{ minHeight: 52 }} onClick={() => setMobile(m)}>
                    <span className="grow stack" style={css({ '--gap': '0' })}>
                      <span className="row-title" style={{ fontSize: 14 }}>{label}</span>
                      <span className="row-sub num">{fmtMobile(m)}</span>
                    </span>
                  </button>
                ))}
              </div>
              <a className="micro" href="/dev/sms">Open the SMS inbox (visitor phone simulator) →</a>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
