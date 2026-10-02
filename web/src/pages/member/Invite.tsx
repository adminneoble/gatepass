import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarClock, Check, Copy, MessageSquareText, Plus, QrCode, Share2, Ticket, TicketX } from 'lucide-react';
import { api } from '../../lib/api';
import { useFeedback } from '../../lib/feedback';
import { useSociety } from '../../lib/session';
import { addDays, dayLabel, fmtMobile, isoDay } from '../../lib/format';
import { PURPOSES, type Pass, type PassState } from '../../lib/types';
import { Button, Chips, Empty, Field, MobileField, PURPOSE_ICON, PURPOSE_TONE, QR, Seg, SectionHead, Sheet, Skeleton, Tag, TextField, css } from '../../ui';
import { useUnit } from './context';
import { ExtendSheet, type ExtendTarget } from './sheets';

const STATE_TAG: Record<PassState, [string, 'positive' | 'pending' | 'neutral' | 'danger']> = {
  valid: ['Active', 'positive'], upcoming: ['Scheduled', 'pending'], used: ['Used', 'neutral'], expired: ['Expired', 'neutral'], revoked: ['Revoked', 'danger'],
};
const DATE_MODES = ['Today', 'Tomorrow', 'Pick date'] as const;
const SLOTS = ['Any time', 'Morning', 'Afternoon', 'Evening', 'Custom'] as const;
const PRESET: Record<string, [string, string]> = { Morning: ['09:00', '12:00'], Afternoon: ['12:00', '16:00'], Evening: ['16:00', '20:00'] };
const SLOT_HINT: Record<string, string> = { Morning: '9–12', Afternoon: '12–4', Evening: '4–8' };
const revocable = (p: Pass) => p.state === 'valid' || p.state === 'upcoming';

export default function Invite() {
  const { unit } = useUnit();
  const qc = useQueryClient();
  const { fail } = useFeedback();
  const society = useSociety().data;
  const passes = useQuery({ queryKey: ['passes', unit.id], queryFn: () => api.get<Pass[]>(`/me/units/${unit.id}/passes`) });
  const [name, setName] = useState('');
  const [mobile, setMobile] = useState('');
  const [purpose, setPurpose] = useState<(typeof PURPOSES)[number]>('Guest');
  const today = isoDay();
  const [dateMode, setDateMode] = useState<(typeof DATE_MODES)[number]>('Today');
  const [pickDay, setPickDay] = useState(addDays(today, 2));
  const [slot, setSlot] = useState<(typeof SLOTS)[number]>('Any time');
  const [cFrom, setCFrom] = useState('10:00');
  const [cTo, setCTo] = useState('12:00');
  const day = dateMode === 'Today' ? today : dateMode === 'Tomorrow' ? addDays(today, 1) : pickDay;
  const [sFrom, sTo] = slot === 'Any time' ? [undefined, undefined] : slot === 'Custom' ? [cFrom, cTo] : PRESET[slot];
  const nowHM = new Date().toTimeString().slice(0, 5);
  const dayErr = dateMode === 'Pick date' && (!pickDay || pickDay < today || pickDay > addDays(today, 3)) ? 'Pick a date within the next 3 days.' : null;
  const slotErr = sFrom && sTo ? (sTo <= sFrom ? 'The end time must be after the start time.' : day === today && sTo <= nowHM ? 'This slot has already passed today. Pick a later one.' : null) : null;
  const [genId, setGenId] = useState<number | null>(null);
  const [ext, setExt] = useState<ExtendTarget | null>(null);
  const [revoking, setRevoking] = useState<Pass | null>(null);

  const gen = useMutation({
    mutationFn: () => api.post<Pass>('/passes', { unitId: unit.id, name, mobile, purpose, date: day, slotFrom: sFrom, slotTo: sTo }),
    onSuccess: p => { setGenId(p.id); setName(''); setMobile(''); qc.invalidateQueries({ queryKey: ['passes'] }); },
    onError: fail,
  });
  const generated = passes.data?.find(p => p.id === genId) ?? (gen.data?.id === genId ? gen.data : undefined);

  return (
    <main className="content shell-col">
      {generated && generated.state !== 'revoked' ? <PassCard p={generated} onNew={() => setGenId(null)} onRevoke={() => setRevoking(generated)} /> : (
        <section className="card accent" style={css({ gap: '16px', paddingTop: '20px' })}>
          <div className="row" style={css({ '--gap': '10px' })}>
            <div className="icon-tile ink"><Ticket size={18} /></div>
            <div className="stack" style={css({ '--gap': '0' })}>
              <span className="title-sm">Pre-approve a visitor</span>
              <span className="micro">They get a code and QR{society?.autoSharePass ? ' by SMS' : ''}</span>
            </div>
          </div>
          <TextField label="Visitor name" value={name} onChange={setName} placeholder="Full name" />
          <MobileField label="Visitor mobile" value={mobile} onChange={setMobile} />
          <Field label="Purpose of visit"><Chips options={PURPOSES} value={purpose} onChange={setPurpose} icons={PURPOSE_ICON} tones={PURPOSE_TONE} /></Field>
          <Field label="Date">
            <Seg label="Date" options={DATE_MODES} value={dateMode} onChange={setDateMode} block />
          </Field>
          {dateMode === 'Pick date' && (
            <TextField label="Visit date" type="date" value={pickDay} onChange={setPickDay} min={today} max={addDays(today, 3)} error={dayErr} hint="Up to 3 days ahead." />
          )}
          <Field label="Time slot (optional)">
            <div className="chips">
              {SLOTS.map(o => (
                <button key={o} type="button" className="chip" aria-pressed={o === slot} onClick={() => setSlot(o)}>
                  {o}{SLOT_HINT[o] && <span className="micro" style={{ color: 'inherit', opacity: 0.7 }}>{SLOT_HINT[o]}</span>}
                </button>
              ))}
            </div>
          </Field>
          {slot === 'Custom' && (
            <div className="grid-2">
              <TextField label="From" type="time" value={cFrom} onChange={setCFrom} />
              <TextField label="To" type="time" value={cTo} onChange={setCTo} />
            </div>
          )}
          {slotErr ? <div className="notice danger"><span>{slotErr}</span></div> : !dayErr && (
            <div className="notice"><CalendarClock size={16} /><span>
              {sFrom
                ? <>Security will allow entry only on <strong>{dayLabel(day)}</strong> between <strong>{sFrom}</strong> and <strong>{sTo}</strong>.</>
                : <>Valid from <strong>{day === today ? 'now' : dayLabel(day)}</strong> for {society?.passValidity ?? '24 hours'}, any time.</>}
            </span></div>
          )}
          <Button variant="primary" size="lg" block icon={QrCode} disabled={!name.trim() || mobile.length !== 10 || !!dayErr || !!slotErr} loading={gen.isPending} onClick={() => gen.mutate()}>Generate code and QR</Button>
        </section>
      )}

      <SectionHead title="Passes issued" count={passes.data?.length} />
      {passes.isLoading ? <Skeleton /> : !passes.data?.length ? <Empty icon={Ticket} title="No passes yet">Passes you create for {unit.id} appear here.</Empty> : (
        <div className="list">
          {passes.data.map(p => {
            const [label, tone] = p.state === 'valid' && !p.sent ? ['Not shared', 'pending' as const] : STATE_TAG[p.state];
            return (
              <div key={p.id} className="list-row row-top">
                <div className={'icon-tile' + (p.state === 'valid' ? ' toned tone-violet' : ' muted')}><Ticket size={18} /></div>
                <div className="grow stack" style={css({ '--gap': '4px' })}>
                  <div className="row" style={css({ '--gap': '8px' })}>
                    <span className="row-title grow ellipsis">{p.name}</span>
                    <Tag tone={tone}>{label}</Tag>
                  </div>
                  <span className="row-sub"><span className="num strong" style={{ color: 'var(--ink-2)', letterSpacing: '0.06em', textDecoration: p.state === 'revoked' ? 'line-through' : undefined }}>{p.code}</span> · {p.state === 'revoked' ? `Revoked at ${p.revokedAt}` : p.validLabel}</span>
                  {(p.state !== 'revoked' || revocable(p)) && (
                    <div className="row" style={css({ '--gap': '4px', marginLeft: '-10px' })}>
                      {p.state !== 'revoked' && <Button variant="ghost" size="sm" onClick={() => setExt({ name: p.name, mobile: p.mobile, purpose: p.purpose, passId: p.id })}>Extend</Button>}
                      {revocable(p) && <Button variant="ghost" size="sm" icon={TicketX} style={{ color: 'var(--danger)' }} onClick={() => setRevoking(p)}>Revoke</Button>}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
      {ext && <ExtendSheet target={ext} onClose={() => setExt(null)} />}
      {revoking && <RevokeSheet p={revoking} onClose={() => setRevoking(null)} />}
    </main>
  );
}

function PassCard({ p, onNew, onRevoke }: { p: Pass; onNew: () => void; onRevoke: () => void }) {
  const { toast, fail } = useFeedback();
  const share = useMutation({ mutationFn: () => api.post<Pass>(`/passes/${p.id}/share`), onSuccess: () => toast('Pass sent by SMS'), onError: fail });
  const canShare = typeof navigator.share === 'function';
  const nativeShare = async () => {
    const text = `Your entry pass for ${p.unitId}. Code ${p.code}. ${p.url}`;
    try {
      if (canShare) await navigator.share({ title: 'Entry pass', text });
      else { await navigator.clipboard.writeText(text); toast('Pass link copied'); }
    } catch { /* cancelled */ }
  };
  return (
    <section className="card accent" style={{ boxShadow: 'var(--shadow-md)', animation: 'pop 260ms var(--ease)', paddingTop: 20 }}>
      <span className="kicker">Pass ready · {p.name}</span>
      <div className="row row-top" style={css({ '--gap': '16px' })}>
        <QR value={p.token} size={136} />
        <div className="stack" style={css({ '--gap': '6px' })}>
          <span className="kicker">Entry code</span>
          <span className="code-display" style={{ fontSize: 34 }}>{p.code}</span>
          <span className="meta">{p.validLabel}</span>
          <span className="meta">{p.purpose} · {p.unitId}</span>
        </div>
      </div>
      {p.sent
        ? <div className="notice ok"><Check size={16} /><span>Sent by SMS to <strong className="num">{fmtMobile(p.mobile)}</strong>.</span></div>
        : <Button variant="primary" size="lg" block icon={MessageSquareText} loading={share.isPending} onClick={() => share.mutate()}>Send code and QR by SMS</Button>}
      <div className="row wrap" style={css({ '--gap': '8px' })}>
        <Button icon={canShare ? Share2 : Copy} onClick={nativeShare}>{canShare ? 'Share' : 'Copy link'}</Button>
        <Button variant="ghost" icon={Plus} onClick={onNew}>Pre-approve another visitor</Button>
        {revocable(p) && <Button variant="danger" icon={TicketX} onClick={onRevoke}>Revoke</Button>}
      </div>
    </section>
  );
}

/** Confirm before cancelling a pass; the code stops working at the gate immediately. */
function RevokeSheet({ p, onClose }: { p: Pass; onClose: () => void }) {
  const qc = useQueryClient();
  const { banner, fail } = useFeedback();
  const m = useMutation({
    mutationFn: () => api.post<{ message: string }>(`/passes/${p.id}/revoke`),
    onSuccess: r => { banner({ text: r.message, tone: 'info', source: 'Gatepass' }); qc.invalidateQueries({ queryKey: ['passes'] }); onClose(); },
    onError: fail,
  });
  return (
    <Sheet title={`Revoke pass for ${p.name}?`} sub={<>Code <strong className="num">{p.code}</strong> · {p.purpose} · {p.validLabel}</>} onClose={onClose}
      actions={<>
        <Button variant="danger" size="lg" icon={TicketX} loading={m.isPending} onClick={() => m.mutate()}>Revoke pass</Button>
        <Button size="lg" onClick={onClose}>Cancel</Button>
      </>}>
      <div className="notice plain">
        <span>The code and QR stop working at the gate immediately.{p.sent ? ` ${p.name} will get an SMS that the pass was cancelled.` : ''} This can't be undone — create a new pass if plans change again.</span>
      </div>
    </Sheet>
  );
}
