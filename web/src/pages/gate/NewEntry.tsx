import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import { BellRing, Camera, Check, MessageSquareText, Search, ShieldCheck, TriangleAlert, UsersRound } from 'lucide-react';
import { api } from '../../lib/api';
import { useFeedback } from '../../lib/feedback';
import { useSociety } from '../../lib/session';
import { resizeImage } from '../../lib/image';
import { digits } from '../../lib/format';
import { PURPOSES, type Recipient } from '../../lib/types';
import { Button, Chips, CodeInput, Field, MobileField, Notice, PURPOSE_ICON, PURPOSE_TONE, Tag, TextField, css } from '../../ui';

type Search = { exact: { id: string; type: string; recipients: Recipient[] } | null; suggestions: { id: string; type: string; notifies: string }[] };

function useDebounced<T>(v: T, ms = 150) {
  const [d, setD] = useState(v);
  useEffect(() => { const t = setTimeout(() => setD(v), ms); return () => clearTimeout(t); }, [v, ms]);
  return d;
}

export default function NewEntry() {
  const nav = useNavigate();
  const { toast, fail } = useFeedback();
  const otpRequired = !!useSociety().data?.otpRequired;

  const [photo, setPhoto] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [unitQ, setUnitQ] = useState('');
  const [mobile, setMobile] = useState('');
  const [purpose, setPurpose] = useState<(typeof PURPOSES)[number] | ''>('');
  const [otpSent, setOtpSent] = useState(false);
  const [otp, setOtp] = useState('');
  const [verified, setVerified] = useState(false);
  const [devCode, setDevCode] = useState<string | null>(null);
  const [focusUnit, setFocusUnit] = useState(false);

  const q = useDebounced(unitQ.trim());
  const search = useQuery({ queryKey: ['units', 'search', q], queryFn: () => api.get<Search>('/directory/search?q=' + encodeURIComponent(q)), enabled: !!q, placeholderData: p => p });
  const unit = q && search.data?.exact;
  const suggestions = q && !unit ? search.data?.suggestions ?? [] : [];
  const missing = !!q && !search.isFetching && !unit && suggestions.length === 0;

  const sendOtp = useMutation({
    mutationFn: () => api.post<{ devCode?: string }>('/visitor-otp', { mobile }),
    onSuccess: r => { setOtpSent(true); setOtp(''); setDevCode(r.devCode ?? null); toast('OTP sent to the visitor'); },
    onError: fail,
  });
  const checkOtp = useMutation({
    mutationFn: (code: string) => api.post('/visitor-otp/verify', { mobile, code }),
    onSuccess: () => { setVerified(true); setDevCode(null); },
    onError: e => { setOtp(''); fail(e); },
  });
  const submit = useMutation({
    mutationFn: () => api.post<{ sentTo: string }>('/visits', { name, mobile, unitId: unit && unit.id, purpose, photo }),
    onSuccess: r => { toast(`Sent to ${r.sentTo} for approval`); nav('/gate'); },
    onError: fail,
  });

  const needOtp = otpRequired && !verified;
  const ready = name.trim() && mobile.length === 10 && unit && purpose && !needOtp;

  const onPhoto = async (f?: File) => { if (f) try { setPhoto(await resizeImage(f, 360)); } catch (e) { fail(e); } };

  return (
    <main className="content shell-col" style={css({ '--col': '560px' })}>
      <div className="row row-top" style={css({ '--gap': '14px' })}>
        <label className="photo-capture">
          <input type="file" accept="image/*" capture="user" aria-label="Take visitor photo" onChange={e => onPhoto(e.target.files?.[0])} />
          {photo ? <><img src={photo} alt="Visitor" /><span className="retake">Retake</span></> : <><Camera size={24} /><span>Take photo</span></>}
        </label>
        <div className="grow stack" style={css({ '--gap': '12px' })}>
          <TextField label="Visitor name" value={name} onChange={setName} placeholder="Full name" autoFocus />
          <Field label="Flat / office">
            <div className="input-group" style={{ position: 'relative' }}>
              <Search size={18} className="input-icon" />
              <input className="input has-icon" value={unitQ} placeholder="Flat, office or name" aria-invalid={missing}
                onFocus={() => setFocusUnit(true)} onBlur={() => setTimeout(() => setFocusUnit(false), 150)}
                onChange={e => setUnitQ(e.target.value)} aria-autocomplete="list" />
              {focusUnit && suggestions.length > 0 && (
                <div className="suggest" role="listbox">
                  {suggestions.map(s => (
                    <button key={s.id} type="button" role="option" aria-selected={false} onMouseDown={e => e.preventDefault()} onClick={() => { setUnitQ(s.id); setFocusUnit(false); }}>
                      <span className="row-title" style={{ fontSize: 14 }}>{s.id} · {s.type}</span>
                      <span className="row-sub">Notifies {s.notifies}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </Field>
        </div>
      </div>

      {unit && (
        <div className="recipients">
          <UsersRound size={18} style={{ marginTop: 2 }} />
          <div className="stack" style={css({ '--gap': '4px' })}>
            <span className="kicker">Request goes to</span>
            {unit.recipients.map(r => (
              <span key={r.phone} style={{ fontSize: 14 }}><strong>{r.name}</strong> <span className="muted">· {r.role} · <span className="num">{r.phone}</span></span></span>
            ))}
          </div>
        </div>
      )}
      {missing && <Notice tone="danger" icon={TriangleAlert}>Not in the directory. Check the flat or office number.</Notice>}

      <MobileField value={mobile} onChange={v => { setMobile(v); setVerified(false); setOtpSent(false); setOtp(''); }}
        trailing={otpRequired && (verified
          ? <Tag tone="positive"><Check size={12} />Verified</Tag>
          : <Button icon={MessageSquareText} disabled={mobile.length !== 10} loading={sendOtp.isPending} onClick={() => sendOtp.mutate()}>{otpSent ? 'Resend' : 'Send OTP'}</Button>)} />

      {otpRequired && otpSent && !verified && (
        <Field label="OTP from visitor's SMS" hint={devCode ? <>Development: the code is <strong className="num">{devCode}</strong>.</> : 'Ask the visitor to read out the 4-digit code.'}>
          <CodeInput length={4} label="Visitor OTP" value={otp} autoFocus state={checkOtp.isError ? 'error' : undefined}
            onChange={v => { setOtp(digits(v, 4)); if (v.length === 4) checkOtp.mutate(v); }} />
        </Field>
      )}

      <Field label="Purpose of visit">
        <Chips options={PURPOSES} value={purpose} onChange={setPurpose} icons={PURPOSE_ICON} tones={PURPOSE_TONE} />
      </Field>

      <Button variant="primary" size="lg" block icon={BellRing} disabled={!ready} loading={submit.isPending} onClick={() => submit.mutate()}>
        Notify resident for approval
      </Button>
      {needOtp && <Notice tone="plain" icon={ShieldCheck}>Admin requires mobile verification before entry.</Notice>}
    </main>
  );
}
