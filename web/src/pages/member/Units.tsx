import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowRight, Building2, CircleUserRound, Info, UserPlus } from 'lucide-react';
import { api } from '../../lib/api';
import { useFeedback } from '../../lib/feedback';
import { useMe } from '../../lib/session';
import { fmtMobile } from '../../lib/format';
import type { MyUnit } from '../../lib/types';
import { Button, CodeInput, Field, MobileField, Notice, Tag, TextField, Toggle, css } from '../../ui';
import { useUnit } from './context';

export default function Units() {
  const { units } = useUnit();
  return (
    <main className="content shell-col">
      <p className="meta">Owners and tenants use this same app. Security picks the unit at the gate and the request goes to the number registered here. Tenant changes are made by the admin on request.</p>
      <Profile />
      {units.map(u => <UnitCard key={u.id} u={u} />)}
    </main>
  );
}

function Profile() {
  const me = useMe().data?.user;
  const { unit } = useUnit();
  const qc = useQueryClient();
  const { banner } = useFeedback();
  const [edit, setEdit] = useState<{ name: string; mobile: string; code: string; otp: boolean; devCode?: string } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: () => api.patch<{ otpSent?: boolean; devCode?: string; message?: string }>('/me/profile', { name: edit!.name, mobile: edit!.mobile, code: edit!.otp ? edit!.code : undefined, unitId: unit.id }),
    onSuccess: r => {
      if (r.otpSent) { setEdit(e => e && { ...e, otp: true, code: '', devCode: r.devCode }); setErr(null); return; }
      banner({ text: r.message ?? 'Profile updated.', tone: 'info', source: 'Gatepass' });
      setEdit(null);
      qc.invalidateQueries({ queryKey: ['me'] });
    },
    onError: e => setErr(e.message),
  });
  if (!me) return null;
  const changed = !!edit && edit.mobile !== me.mobile;
  const label = !changed ? 'Save' : edit!.otp ? 'Verify and save' : 'Send OTP';
  const cant = !edit || !edit.name.trim() || edit.mobile.length !== 10 || (edit.otp && edit.code.length !== 4);

  return (
    <section className="card">
      <div className="card-head">
        <CircleUserRound size={18} />
        <span className="kicker grow" style={{ color: 'var(--ink-2)' }}>My profile</span>
        {!edit && <Button variant="ghost" size="sm" onClick={() => { setErr(null); setEdit({ name: me.name, mobile: me.mobile, code: '', otp: false }); }}>Edit</Button>}
      </div>
      {!edit ? (
        <div className="stack" style={css({ '--gap': '2px' })}>
          <span className="title">{me.name}</span>
          <span className="meta"><span className="num">{fmtMobile(me.mobile)}</span> · signs you in and receives gate requests</span>
        </div>
      ) : (
        <div className="stack" style={css({ '--gap': '12px' })}>
          <TextField label="Name" value={edit.name} onChange={v => setEdit({ ...edit, name: v })} placeholder="Full name" />
          <MobileField value={edit.mobile} onChange={v => { setEdit({ ...edit, mobile: v, otp: false, code: '' }); setErr(null); }} />
          {edit.otp && (
            <Field label="OTP sent to the new number" hint={edit.devCode ? <>Development: the code is <strong className="num">{edit.devCode}</strong>.</> : undefined}>
              <CodeInput length={4} label="Verification code" value={edit.code} autoFocus onChange={v => { setEdit({ ...edit, code: v }); setErr(null); }} state={err ? 'error' : undefined} />
            </Field>
          )}
          {err && <Notice tone="danger">{err}</Notice>}
          <div className="row" style={css({ '--gap': '8px' })}>
            <Button variant="primary" disabled={cant} loading={save.isPending} onClick={() => save.mutate()}>{label}</Button>
            <Button onClick={() => setEdit(null)}>Cancel</Button>
          </div>
          <span className="micro">A new number is confirmed by OTP and updates on every unit you hold.</span>
        </div>
      )}
    </section>
  );
}

function UnitCard({ u }: { u: MyUnit }) {
  const { toast, banner, fail } = useFeedback();
  const [adding, setAdding] = useState(false);
  const [tName, setTName] = useState('');
  const [tMobile, setTMobile] = useState('');
  const routing = useMutation({ mutationFn: (b: { divertToTenant?: boolean; ccOwner?: boolean }) => api.patch(`/me/units/${u.id}/routing`, b), onError: fail });
  const request = useMutation({
    mutationFn: (b: { kind: 'add'; name: string; mobile: string } | { kind: 'remove' }) => api.post(`/me/units/${u.id}/tenant-requests`, b),
    onSuccess: (_d, b) => { banner({ text: b.kind === 'add' ? `Request sent to admin to add ${b.name} to ${u.id}.` : `Request sent to admin to remove ${u.tenant?.name} from ${u.id}.`, tone: 'info', source: 'Gatepass' }); setAdding(false); },
    onError: fail,
  });
  const cancel = useMutation({ mutationFn: (id: number) => api.del(`/me/tenant-requests/${id}`), onSuccess: () => toast('Request cancelled'), onError: fail });

  return (
    <section className="card flush">
      <div className="card-head" style={{ padding: '14px 16px', borderBottom: '1px solid var(--hairline)' }}>
        <Building2 size={18} />
        <span className="title-sm grow">{u.id} <span className="micro" style={{ fontWeight: 500 }}>· {u.type}</span></span>
        <Tag tone={u.tenant ? 'info' : 'neutral'} plain>{u.tenant ? 'Rented out' : 'Self-occupied'}</Tag>
      </div>
      <div className="stack" style={css({ '--gap': '0' })}>
        <PersonRow role="Owner" p={u.owner} />
        {u.tenant && (
          <PersonRow role="Tenant" p={u.tenant} action={u.isOwner && (u.pendingRemove
            ? <Tag tone="pending">Removal requested</Tag>
            : <Button variant="ghost" size="sm" loading={request.isPending} onClick={() => request.mutate({ kind: 'remove' })}>Request removal</Button>)} />
        )}
        {u.tenant && u.isOwner && (
          <div style={{ borderTop: '1px solid var(--hairline)' }}>
            <ToggleRow label="Send visitor requests to tenant" on={u.divertToTenant} onChange={v => routing.mutate({ divertToTenant: v })} />
            {u.divertToTenant && <ToggleRow label="Also notify me" on={u.ccOwner} onChange={v => routing.mutate({ ccOwner: v })} />}
          </div>
        )}
        {u.pendingAdd && (
          <div className="row" style={{ padding: '12px 16px', borderTop: '1px solid var(--hairline)', background: 'var(--sunken)' }}>
            <div className="grow stack" style={css({ '--gap': '1px' })}>
              <span className="kicker">Tenant · awaiting admin</span>
              <span style={{ fontSize: 14, fontWeight: 600 }}>{u.pendingAdd.name} · <span className="num">{fmtMobile(u.pendingAdd.mobile)}</span></span>
            </div>
            <Button variant="ghost" size="sm" loading={cancel.isPending} onClick={() => cancel.mutate(u.pendingAdd!.id)}>Cancel</Button>
          </div>
        )}
        {adding && (
          <div className="stack" style={{ padding: 16, borderTop: '1px solid var(--hairline)', gap: 12 }}>
            <span className="micro">The admin verifies and adds the tenant. Your tenant then signs in to Gatepass with this number.</span>
            <TextField label="Tenant name" value={tName} onChange={setTName} placeholder="Full name" autoFocus />
            <MobileField label="Tenant mobile" value={tMobile} onChange={setTMobile} />
            <div className="row" style={css({ '--gap': '8px' })}>
              <Button variant="primary" icon={ArrowRight} disabled={!tName.trim() || tMobile.length !== 10} loading={request.isPending} onClick={() => request.mutate({ kind: 'add', name: tName.trim(), mobile: tMobile })}>Send to admin</Button>
              <Button onClick={() => setAdding(false)}>Cancel</Button>
            </div>
          </div>
        )}
        {u.isOwner && !u.tenant && !u.pendingAdd && !adding && (
          <div style={{ padding: '8px 8px', borderTop: '1px solid var(--hairline)' }}>
            <Button variant="ghost" icon={UserPlus} onClick={() => { setTName(''); setTMobile(''); setAdding(true); }}>Request admin to add tenant</Button>
          </div>
        )}
        {!u.isOwner && (
          <div style={{ padding: '0 16px 12px' }}><Notice tone="plain" icon={Info}>You are the tenant here. The owner decides whether visitor requests come to you.</Notice></div>
        )}
      </div>
      <div className="row" style={{ padding: '12px 16px', background: 'var(--sunken)', borderTop: '1px solid var(--hairline)', fontSize: 13 }}>
        <ArrowRight size={14} /><span>Requests go to <strong>{u.goesTo}</strong></span>
      </div>
    </section>
  );
}

function PersonRow({ role, p, action }: { role: string; p: { name: string; mobile: string; isMe: boolean }; action?: React.ReactNode }) {
  return (
    <div className="row" style={{ padding: '12px 16px', borderTop: role === 'Owner' ? 0 : '1px solid var(--hairline)' }}>
      <div className="grow stack" style={css({ '--gap': '1px' })}>
        <span className="kicker">{role}</span>
        <span style={{ fontSize: 15, fontWeight: 600 }}>{p.name}{p.isMe && <span className="muted" style={{ fontWeight: 400 }}> (you)</span>}</span>
        <span className="row-sub num">{fmtMobile(p.mobile)}</span>
      </div>
      {action}
    </div>
  );
}

function ToggleRow({ label, on, onChange }: { label: string; on: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="row" style={{ padding: '12px 16px', minHeight: 52 }}>
      <span className="grow" style={{ fontSize: 14, fontWeight: 600 }}>{label}</span>
      <Toggle label={label} on={on} onChange={onChange} />
    </div>
  );
}
