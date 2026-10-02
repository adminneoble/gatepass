import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Building2, Check, Pencil, Search, TriangleAlert, UserPlus, X } from 'lucide-react';
import { api } from '../../lib/api';
import { useFeedback } from '../../lib/feedback';
import { fmtMobile, plural } from '../../lib/format';
import type { AdminUnit, PersonRef } from '../../lib/types';
import { Button, Chips, Empty, Field, MobileField, Notice, Seg, SectionHead, Sheet, Skeleton, Tag, TextField, css } from '../../ui';
import { useTenantRequests } from './AdminApp';

const useUnits = () => useQuery({ queryKey: ['units', 'admin'], queryFn: () => api.get<AdminUnit[]>('/admin/units') });
const person = (p: PersonRef | null) => (p ? `${p.name} · ${fmtMobile(p.mobile)}` : '—');

export default function Directory() {
  const units = useUnits();
  const reqs = useTenantRequests().data ?? [];
  const [q, setQ] = useState('');
  const [sheet, setSheet] = useState<{ mode: 'add' } | { mode: 'edit'; unit: AdminUnit } | null>(null);
  const ql = q.trim().toLowerCase();
  const list = (units.data ?? []).filter(u => !ql || [u.id, u.owner.name, u.owner.mobile, u.tenant?.name, u.tenant?.mobile].some(x => x?.toLowerCase().includes(ql)));

  return (
    <div className="stack">
      {reqs.length > 0 && (
        <>
          <SectionHead title="Tenant requests" count={reqs.length} />
          {reqs.map(r => <RequestCard key={r.id} r={r} />)}
        </>
      )}

      <div className="row wrap" style={css({ '--gap': '10px' })}>
        <div className="input-group grow" style={{ minWidth: 220 }}>
          <Search size={18} className="input-icon" />
          <input className="input has-icon" value={q} onChange={e => setQ(e.target.value)} placeholder="Search unit, owner, tenant or phone" aria-label="Search directory" />
        </div>
        <Button variant="primary" icon={UserPlus} onClick={() => setSheet({ mode: 'add' })}>Add member</Button>
      </div>
      <SectionHead title="Units" count={list.length} />

      {units.isLoading ? <Skeleton n={4} h={96} /> : list.length === 0 ? <Empty icon={Building2} title={q ? 'No matches' : 'No units yet'}>{q ? 'Try a unit number, name or phone.' : 'Add the first member to create a unit.'}</Empty> : (
        <>
          <table className="table dir-table">
            <thead><tr><th>Unit</th><th>Owner</th><th>Tenant</th><th>Requests go to</th><th /></tr></thead>
            <tbody>
              {list.map(u => (
                <tr key={u.id}>
                  <td><div className="stack" style={css({ '--gap': '4px' })}><strong style={{ fontSize: 15 }}>{u.id}</strong><Tag tone="neutral" plain>{u.type}</Tag></div></td>
                  <td><div className="stack" style={css({ '--gap': '0' })}><span style={{ fontWeight: 600 }}>{u.owner.name}</span><span className="micro num">{fmtMobile(u.owner.mobile)}</span></div></td>
                  <td>{u.tenant ? <div className="stack" style={css({ '--gap': '0' })}><span style={{ fontWeight: 600 }}>{u.tenant.name}</span><span className="micro num">{fmtMobile(u.tenant.mobile)}</span></div> : <span className="muted">—</span>}</td>
                  <td className="meta" style={{ maxWidth: 240 }}>{u.goesTo}</td>
                  <td style={{ textAlign: 'right' }}><Button variant="ghost" size="sm" icon={Pencil} onClick={() => setSheet({ mode: 'edit', unit: u })}>Edit</Button></td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="dir-cards">
            {list.map(u => (
              <section key={u.id} className="card" style={{ gap: 10 }}>
                <div className="card-head">
                  <Building2 size={18} />
                  <span className="title-sm">{u.id}</span>
                  <Tag tone="neutral" plain>{u.type}</Tag>
                  <span className="grow" />
                  <Button variant="ghost" size="sm" icon={Pencil} onClick={() => setSheet({ mode: 'edit', unit: u })}>Edit</Button>
                </div>
                <dl style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '4px 14px', margin: 0, fontSize: 13 }}>
                  <dt className="kicker" style={{ paddingTop: 2 }}>Owner</dt><dd style={{ margin: 0 }}>{person(u.owner)}</dd>
                  <dt className="kicker" style={{ paddingTop: 2 }}>Tenant</dt><dd style={{ margin: 0 }}>{person(u.tenant)}</dd>
                  <dt className="kicker" style={{ paddingTop: 2 }}>Notifies</dt><dd style={{ margin: 0, fontWeight: 600 }}>{u.goesTo}</dd>
                </dl>
              </section>
            ))}
          </div>
        </>
      )}
      <p className="micro">One person can hold several units. Owners request tenant changes from their app and the admin approves them here. Tenants sign in to the same app with their registered number.</p>

      {sheet && <MemberSheet key={sheet.mode === 'edit' ? sheet.unit.id : 'add'} state={sheet} units={units.data ?? []} onClose={() => setSheet(null)} />}
    </div>
  );
}

function RequestCard({ r }: { r: import('../../lib/types').TenantRequest }) {
  const { toast, fail } = useFeedback();
  const [sendTo, setSendTo] = useState<Notify | ''>('');
  const needsChoice = r.kind === 'add';
  const m = useMutation({
    mutationFn: (a: 'approve' | 'reject') => api.post(`/admin/tenant-requests/${r.id}/${a}`, a === 'approve' && needsChoice ? { notify: sendTo } : {}),
    onSuccess: (_d, a) => toast(a === 'approve' ? 'Request approved · owner notified' : 'Request rejected · owner notified'),
    onError: fail,
  });
  return (
    <section className="card" style={{ borderLeft: '3px solid var(--primary)' }}>
      <div className="card-head">
        <span className="title-sm grow">{r.kind === 'add' ? 'Add tenant' : 'Remove tenant'} · {r.unitId}</span>
        <Tag tone="pending">Pending</Tag>
      </div>
      <span style={{ fontWeight: 600 }}>{r.name} · <span className="num">{fmtMobile(r.mobile)}</span></span>
      <span className="micro">Requested by {r.requestedBy} (owner) · {r.time}</span>
      {needsChoice && <NotifyField value={sendTo} onChange={setSendTo} owner={r.requestedBy} tenant={r.name} />}
      <div className="row" style={css({ '--gap': '8px' })}>
        <Button variant="primary" icon={Check} loading={m.isPending && m.variables === 'approve'} disabled={m.isPending || (needsChoice && !sendTo)} onClick={() => m.mutate('approve')}>Approve</Button>
        <Button icon={X} loading={m.isPending && m.variables === 'reject'} disabled={m.isPending} onClick={() => m.mutate('reject')}>Reject</Button>
      </div>
    </section>
  );
}

const NOTIFY = ['Owner', 'Tenant', 'Both'] as const;
type Notify = (typeof NOTIFY)[number];
const currentNotify = (u: AdminUnit): Notify | '' => (!u.tenant ? '' : !u.divertToTenant ? 'Owner' : u.ccOwner ? 'Both' : 'Tenant');

/** Explicit choice of who receives visitor requests when a unit has a tenant. */
function NotifyField({ value, onChange, owner, tenant }: { value: Notify | ''; onChange: (v: Notify) => void; owner: string; tenant: string }) {
  const who: Record<Notify, string> = { Owner: owner || 'the owner', Tenant: tenant || 'the tenant', Both: `${owner || 'owner'} and ${tenant || 'tenant'}` };
  return (
    <Field label="Visitor requests go to" error={value ? null : 'Choose who should be notified when a visitor arrives.'}
      hint={value ? <>Security will notify <strong>{who[value]}</strong>.</> : undefined}>
      <Chips options={NOTIFY} value={value} onChange={onChange} />
    </Field>
  );
}

type SheetState = { mode: 'add' } | { mode: 'edit'; unit: AdminUnit };

function MemberSheet({ state, units, onClose }: { state: SheetState; units: AdminUnit[]; onClose: () => void }) {
  const { toast, fail } = useFeedback();
  const edit = state.mode === 'edit' ? state.unit : null;
  // add
  const [unitId, setUnitId] = useState('');
  const [type, setType] = useState<'Flat' | 'Office'>('Flat');
  const [role, setRole] = useState<'Owner' | 'Tenant'>('Owner');
  const [name, setName] = useState('');
  const [mobile, setMobile] = useState('');
  // edit
  const [o, setO] = useState<PersonRef>(edit?.owner ?? { name: '', mobile: '' });
  const [t, setT] = useState<PersonRef>(edit?.tenant ?? { name: '', mobile: '' });
  const [notify, setNotify] = useState<Notify | ''>(edit ? currentNotify(edit) : '');

  const id = unitId.trim().toUpperCase();
  const ex = !edit && id ? units.find(u => u.id === id) : undefined;
  const warn = ex && (role === 'Owner' ? `This replaces the current owner, ${ex.owner.name}.` : ex.tenant ? `This replaces the current tenant, ${ex.tenant.name}.` : '');
  const tBlank = !t.name.trim() && !t.mobile;
  const tOk = tBlank || (t.name.trim() && t.mobile.length === 10);
  const addingTenant = !!ex && role === 'Tenant';
  const askNotify = edit ? !tBlank : addingTenant;

  const m = useMutation({
    mutationFn: () => edit
      ? api.patch<{ message: string }>(`/admin/units/${edit.id}`, { owner: { name: o.name.trim(), mobile: o.mobile }, tenant: tBlank ? null : { name: t.name.trim(), mobile: t.mobile }, notify: tBlank ? undefined : notify })
      : api.post<{ message: string }>('/admin/members', { unitId: id, type, role: ex ? role : 'Owner', name: name.trim(), mobile, notify: addingTenant ? notify : undefined }),
    onSuccess: r => { toast(r.message); onClose(); },
    onError: fail,
  });
  const cant = (edit ? !o.name.trim() || o.mobile.length !== 10 || !tOk : !id || !name.trim() || mobile.length !== 10) || (askNotify && !notify);

  return (
    <Sheet title={edit ? `Edit ${edit.id}` : 'Add member'} sub="Members sign in to Gatepass with their registered mobile number." onClose={onClose}
      actions={<>
        <Button variant="primary" size="lg" disabled={!!cant} loading={m.isPending} onClick={() => m.mutate()}>{edit ? 'Save changes' : 'Add member'}</Button>
        <Button size="lg" onClick={onClose}>Cancel</Button>
      </>}>
      {!edit ? (
        <>
          <TextField label="Flat / office number" value={unitId} onChange={setUnitId} placeholder="e.g. D-201" autoFocus
            hint={id ? (ex ? `Existing ${ex.type.toLowerCase()} · owner ${ex.owner.name}${ex.tenant ? ', tenant ' + ex.tenant.name : ''}` : 'New unit. It will be added to the directory.') : undefined} />
          {id && !ex && <div className="field"><span className="field-label">Type</span><Seg label="Type" options={['Flat', 'Office'] as const} value={type} onChange={setType} /></div>}
          {ex && <div className="field"><span className="field-label">Role</span><Seg label="Role" options={['Owner', 'Tenant'] as const} value={role} onChange={setRole} /></div>}
          <TextField label="Name" value={name} onChange={setName} placeholder="Full name" />
          <MobileField value={mobile} onChange={setMobile} />
          {addingTenant && <NotifyField value={notify} onChange={setNotify} owner={ex!.owner.name} tenant={name.trim()} />}
          {warn && <Notice tone="danger" icon={TriangleAlert}>{warn}</Notice>}
        </>
      ) : (
        <>
          <span className="kicker">Owner</span>
          <TextField label="Name" value={o.name} onChange={v => setO({ ...o, name: v })} />
          <MobileField value={o.mobile} onChange={v => setO({ ...o, mobile: v })} />
          <hr className="rule" />
          <span className="kicker">Tenant</span>
          <TextField label="Name" value={t.name} onChange={v => setT({ ...t, name: v })} placeholder="No tenant" />
          <MobileField value={t.mobile} onChange={v => setT({ ...t, mobile: v })} error={!tOk ? 'Enter both name and a 10-digit mobile, or clear both.' : null} />
          {!tBlank && <><hr className="rule" /><NotifyField value={notify} onChange={setNotify} owner={o.name.trim()} tenant={t.name.trim()} /></>}
          <span className="micro">Clear both tenant fields to remove the tenant. Changes to a person apply to every unit they hold.</span>
          {edit.tenant && tBlank && <Notice tone="danger" icon={TriangleAlert}>{edit.tenant.name} will be removed as tenant of {edit.id}.</Notice>}
        </>
      )}
      <span className="micro">{plural(units.length, 'unit')} in the directory.</span>
    </Sheet>
  );
}
