import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Clock, ImagePlus, MessageSquareText, RotateCcw, ShieldCheck, Trash2 } from 'lucide-react';
import { api } from '../../lib/api';
import { useFeedback } from '../../lib/feedback';
import { useSociety } from '../../lib/session';
import { resizeImage } from '../../lib/image';
import type { Society } from '../../lib/types';
import { Button, MobileField, Seg, Skeleton, TextField, Toggle, css } from '../../ui';

type Patch = Partial<Pick<Society, 'name' | 'logo' | 'gatePhone' | 'supervisorName' | 'supervisorPhone' | 'otpRequired' | 'autoSharePass' | 'passValidity'>>;

function useSave() {
  const qc = useQueryClient();
  const { toast, fail } = useFeedback();
  return useMutation({
    mutationFn: (p: Patch) => api.patch('/society', p),
    onMutate: async p => { qc.setQueryData<Society>(['society'], s => s && { ...s, ...p }); },
    onSuccess: (_d, p) => { qc.invalidateQueries({ queryKey: ['me'] }); if (!('otpRequired' in p || 'autoSharePass' in p || 'passValidity' in p)) toast('Settings saved'); },
    onError: e => { fail(e); qc.invalidateQueries({ queryKey: ['society'] }); },
  });
}

export default function Settings() {
  const s = useSociety().data;
  const save = useSave();
  if (!s) return <Skeleton h={160} n={3} />;
  return (
    <div className="settings-grid">
      <div className="stack">
        <Profile s={s} />
        <Contacts s={s} />
      </div>
      <div className="stack">
        <section className="card flush">
          <ToggleRow tone="indigo" icon={ShieldCheck} title="Verify visitor mobile with OTP" text="Security sends a one-time code by SMS and enters it before logging the visitor."
            on={s.otpRequired} onChange={v => save.mutate({ otpRequired: v })} />
          <ToggleRow tone="sky" icon={MessageSquareText} title="Send pass to visitor's mobile" text="Pre-approved codes go out by SMS with a link to the QR pass. When off, residents share them manually."
            on={s.autoSharePass} onChange={v => save.mutate({ autoSharePass: v })} />
          <div className="stack" style={{ padding: 16, gap: 12, borderTop: '1px solid var(--hairline)' }}>
            <div className="row row-top" style={css({ '--gap': '12px' })}>
              <div className="icon-tile toned tone-amber"><Clock size={18} /></div>
              <div className="stack grow" style={css({ '--gap': '2px' })}>
                <span className="row-title">Pass validity</span>
                <span className="row-sub">How long a pre-approved code stays usable.</span>
              </div>
            </div>
            <Seg label="Pass validity" options={['4 hours', '24 hours', '3 days'] as const} value={s.passValidity} onChange={v => save.mutate({ passValidity: v })} block />
          </div>
        </section>
        <DemoReset />
      </div>
    </div>
  );
}

/** Demo prototype: restore the sample society so the next demo starts clean. */
function DemoReset() {
  const qc = useQueryClient();
  const { toast, fail } = useFeedback();
  const [armed, setArmed] = useState(false);
  useEffect(() => { if (!armed) return; const t = setTimeout(() => setArmed(false), 5000); return () => clearTimeout(t); }, [armed]);
  const reset = useMutation({
    mutationFn: () => api.post<{ message: string; signedOut: boolean }>('/admin/demo/reset'),
    onSuccess: r => { setArmed(false); if (r.signedOut) { location.href = '/login'; return; } qc.invalidateQueries(); toast(r.message); },
    onError: e => { setArmed(false); fail(e); },
  });
  return (
    <section className="card">
      <span className="kicker">Demo</span>
      <div className="row row-top" style={css({ '--gap': '12px' })}>
        <div className="icon-tile toned tone-amber"><RotateCcw size={18} /></div>
        <div className="stack grow" style={css({ '--gap': '2px' })}>
          <span className="row-title">Reset demo data</span>
          <span className="row-sub">Restores Palm Grove Residency with its sample units, visitors and passes. Everything added since is removed and other devices are signed out.</span>
        </div>
      </div>
      <div className="row" style={css({ '--gap': '8px' })}>
        <Button variant={armed ? 'danger' : 'secondary'} icon={RotateCcw} loading={reset.isPending} onClick={() => (armed ? reset.mutate() : setArmed(true))}>
          {armed ? 'Tap again to reset' : 'Reset demo data'}
        </Button>
        {armed && <Button variant="ghost" onClick={() => setArmed(false)}>Cancel</Button>}
      </div>
    </section>
  );
}

function Profile({ s }: { s: Society }) {
  const save = useSave();
  const { fail } = useFeedback();
  const [name, setName] = useState(s.name);
  useEffect(() => setName(s.name), [s.name]);
  const onLogo = async (f?: File) => { if (f) try { save.mutate({ logo: await resizeImage(f, 256, 'image/png') }); } catch (e) { fail(e); } };
  return (
    <section className="card">
      <span className="kicker">Society profile</span>
      <div className="row row-top" style={css({ '--gap': '14px' })}>
        <label className="photo-capture" style={{ width: 80, height: 80 }}>
          <input type="file" accept="image/*" aria-label="Upload society logo" onChange={e => onLogo(e.target.files?.[0])} />
          {s.logo ? <img src={s.logo} alt="Society logo" style={{ filter: 'none' }} /> : <><ImagePlus size={22} /><span>Add logo</span></>}
        </label>
        <div className="grow stack" style={css({ '--gap': '8px' })}>
          <TextField label="Society name" value={name} onChange={setName} placeholder="Society name" />
          <div className="row" style={css({ '--gap': '8px' })}>
            <Button variant="primary" size="sm" disabled={!name.trim() || name === s.name} loading={save.isPending} onClick={() => save.mutate({ name: name.trim() })}>Save name</Button>
            {s.logo && <Button variant="ghost" size="sm" icon={Trash2} onClick={() => save.mutate({ logo: null })}>Remove logo</Button>}
          </div>
        </div>
      </div>
      <span className="micro">Shown in every app, on visitor passes and in SMS.</span>
    </section>
  );
}

function Contacts({ s }: { s: Society }) {
  const save = useSave();
  const [f, setF] = useState({ gatePhone: s.gatePhone, supervisorName: s.supervisorName, supervisorPhone: s.supervisorPhone });
  useEffect(() => setF({ gatePhone: s.gatePhone, supervisorName: s.supervisorName, supervisorPhone: s.supervisorPhone }), [s.gatePhone, s.supervisorName, s.supervisorPhone]);
  const dirty = f.gatePhone !== s.gatePhone || f.supervisorName !== s.supervisorName || f.supervisorPhone !== s.supervisorPhone;
  const valid = f.gatePhone.length === 10 && f.supervisorPhone.length === 10 && f.supervisorName.trim();
  return (
    <section className="card">
      <span className="kicker">Security contacts</span>
      <MobileField label="Main gate phone" value={f.gatePhone} onChange={v => setF({ ...f, gatePhone: v })} />
      <div className="grid-2">
        <TextField label="Supervisor" value={f.supervisorName} onChange={v => setF({ ...f, supervisorName: v })} />
        <MobileField label="Supervisor phone" value={f.supervisorPhone} onChange={v => setF({ ...f, supervisorPhone: v })} />
      </div>
      <span className="micro">Members see these numbers and can call or alert security from their app.</span>
      {dirty && (
        <div className="row" style={css({ '--gap': '8px' })}>
          <Button variant="primary" disabled={!valid} loading={save.isPending} onClick={() => save.mutate({ ...f, supervisorName: f.supervisorName.trim() })}>Save contacts</Button>
          <Button variant="ghost" onClick={() => setF({ gatePhone: s.gatePhone, supervisorName: s.supervisorName, supervisorPhone: s.supervisorPhone })}>Discard</Button>
        </div>
      )}
    </section>
  );
}

function ToggleRow({ icon: Icon, title, text, on, onChange, tone }: { icon: typeof Clock; title: string; text: string; on: boolean; onChange: (v: boolean) => void; tone: string }) {
  return (
    <div className="row row-top" style={{ padding: 16, gap: 12, borderTop: '1px solid var(--hairline)' }}>
      <div className={`icon-tile toned tone-${tone}`}><Icon size={18} /></div>
      <div className="grow stack" style={css({ '--gap': '2px' })}>
        <span className="row-title">{title}</span>
        <span className="row-sub">{text}</span>
      </div>
      <Toggle label={title} on={on} onChange={onChange} />
    </div>
  );
}
