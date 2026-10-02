import { useEffect, useId, useRef, useState, type ButtonHTMLAttributes, type CSSProperties, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import QRCode from 'qrcode';
import { Car, Ellipsis, LoaderCircle, Package, User, Wrench, X, type LucideIcon } from 'lucide-react';
import { digits, initials } from '../lib/format';
import type { VisitStatus } from '../lib/types';

export const css = (v: Record<string, string | number>) => v as CSSProperties;

// ── Buttons ──────────────────────────────────────────────────────────────────

type BtnProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger' | 'on-ink';
  size?: 'sm' | 'md' | 'lg';
  icon?: LucideIcon; trail?: ReactNode; block?: boolean; loading?: boolean;
};
export function Button({ variant = 'secondary', size = 'md', icon: Icon, trail, block, loading, className = '', children, disabled, ...rest }: BtnProps) {
  const cls = ['btn', 'btn-' + variant, size !== 'md' && 'btn-' + size, block && 'btn-block', className].filter(Boolean).join(' ');
  return (
    <button className={cls} disabled={disabled || loading} {...rest}>
      {loading ? <LoaderCircle size={18} className="spin" /> : Icon && <Icon size={18} strokeWidth={2.2} />}
      {children}
      {trail && <span className="btn-trail">{trail}</span>}
    </button>
  );
}

export function IconButton({ icon: Icon, label, badge, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { icon: LucideIcon; label: string; badge?: number }) {
  return (
    <button className="icon-btn" aria-label={label} title={label} {...rest}>
      <Icon size={20} strokeWidth={2} />
      {!!badge && <span className="dot">{badge > 9 ? '9+' : badge}</span>}
    </button>
  );
}

// ── Form controls ────────────────────────────────────────────────────────────

export function Field({ label, hint, error, children, id }: { label: string; hint?: ReactNode; error?: string | null; children: ReactNode; id?: string }) {
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {children}
      {error ? <span className="field-error" role="alert">{error}</span> : hint && <span className="field-hint">{hint}</span>}
    </div>
  );
}

export function TextField({ label, hint, error, value, onChange, placeholder, autoFocus, icon: Icon, type = 'text', ...rest }: {
  label: string; hint?: ReactNode; error?: string | null; value: string; onChange: (v: string) => void; placeholder?: string; autoFocus?: boolean; icon?: LucideIcon; type?: string; min?: string; max?: string; maxLength?: number;
}) {
  const id = useId();
  return (
    <Field label={label} hint={hint} error={error} id={id}>
      <div className="input-group">
        {Icon && <Icon size={18} className="input-icon" />}
        <input id={id} className={'input' + (Icon ? ' has-icon' : '')} type={type} value={value} placeholder={placeholder} autoFocus={autoFocus}
          aria-invalid={!!error} onChange={e => onChange(e.target.value)} {...rest} />
      </div>
    </Field>
  );
}

/** +91 mobile input: digits only, max 10 (handoff rule). */
export function MobileField({ label = 'Mobile number', value, onChange, hint, error, autoFocus, trailing }: {
  label?: string; value: string; onChange: (v: string) => void; hint?: ReactNode; error?: string | null; autoFocus?: boolean; trailing?: ReactNode;
}) {
  const id = useId();
  return (
    <Field label={label} hint={hint} error={error} id={id}>
      <div className="row" style={css({ '--gap': '8px' })}>
        <div className="input-group grow">
          <span className="input-prefix">+91</span>
          <input id={id} className="input num" inputMode="numeric" autoComplete="tel-national" placeholder="10-digit mobile" value={value} autoFocus={autoFocus}
            aria-invalid={!!error} onChange={e => onChange(digits(e.target.value, 10))} />
        </div>
        {trailing}
      </div>
    </Field>
  );
}

/** Boxed code entry backed by a single native input (works with SMS autofill). */
export function CodeInput({ length, value, onChange, state, autoFocus, label }: { length: number; value: string; onChange: (v: string) => void; state?: 'error' | 'ok'; autoFocus?: boolean; label: string }) {
  const [focus, setFocus] = useState(false);
  return (
    <div className={'code-boxes ' + (state ?? '')} style={css({ '--n': length, position: 'relative' })}>
      {Array.from({ length }, (_, i) => (
        <div key={i} className={'code-box' + (value[i] ? ' filled' : '') + (focus && i === value.length ? ' cursor' : '')}>{value[i] ?? ''}</div>
      ))}
      <input className="code-input-native" inputMode="numeric" autoComplete="one-time-code" aria-label={label} value={value} autoFocus={autoFocus}
        onFocus={() => setFocus(true)} onBlur={() => setFocus(false)} onChange={e => onChange(digits(e.target.value, length))} />
    </div>
  );
}

export function Seg<T extends string>({ options, value, onChange, block, label }: { options: readonly T[]; value: T; onChange: (v: T) => void; block?: boolean; label: string }) {
  return (
    <div className={'seg' + (block ? ' block' : '')} role="radiogroup" aria-label={label}>
      {options.map(o => (
        <button key={o} type="button" role="radio" aria-checked={o === value} className="seg-opt" onClick={() => onChange(o)}>{o}</button>
      ))}
    </div>
  );
}

export function Toggle({ on, onChange, label, disabled }: { on: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return <button type="button" role="switch" aria-checked={on} aria-label={label} className="toggle" disabled={disabled} onClick={() => onChange(!on)} />;
}

export const PURPOSE_ICON: Record<string, LucideIcon> = { Guest: User, Delivery: Package, Cab: Car, Service: Wrench, Other: Ellipsis };

/** Identity accents (never green/red, which are reserved for status outlines). */
export type Tone = 'indigo' | 'violet' | 'sky' | 'amber' | 'slate';
export const PURPOSE_TONE: Record<string, Tone> = { Guest: 'indigo', Delivery: 'amber', Cab: 'sky', Service: 'violet', Other: 'slate' };
const TONES: Tone[] = ['indigo', 'violet', 'sky', 'amber', 'slate'];
/** Stable accent for a name, so a person keeps the same colour everywhere. */
export const toneFor = (s: string) => TONES[[...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7) % TONES.length];

export function Chips<T extends string>({ options, value, onChange, icons, tones, grid, danger }: { options: readonly T[]; value: T | ''; onChange: (v: T) => void; icons?: Record<string, LucideIcon>; tones?: Record<string, Tone>; grid?: boolean; danger?: boolean }) {
  return (
    <div className={'chips' + (grid ? ' grid' : '')}>
      {options.map(o => {
        const Icon = icons?.[o];
        return (
          <button key={o} type="button" className={'chip' + (danger ? ' danger' : '') + (tones?.[o] ? ` toned tone-${tones[o]}` : '')} aria-pressed={o === value} onClick={() => onChange(o)}>
            {Icon && <Icon size={16} />}{o}
          </button>
        );
      })}
    </div>
  );
}

// ── Display ──────────────────────────────────────────────────────────────────

type TagTone = 'positive' | 'pending' | 'neutral' | 'danger' | 'info';
export const Tag = ({ tone, children, plain }: { tone: TagTone; children: ReactNode; plain?: boolean }) =>
  <span className={`tag tag-${tone}` + (plain ? ' plain' : '')}>{children}</span>;

const VISIT_TAG: Record<VisitStatus, [string, TagTone]> = {
  pending: ['Awaiting', 'pending'], approved: ['Approved', 'positive'], denied: ['Denied', 'neutral'], inside: ['Inside', 'positive'], exited: ['Exited', 'neutral'],
};
export const VisitTag = ({ status }: { status: VisitStatus }) => <Tag tone={VISIT_TAG[status][1]}>{VISIT_TAG[status][0]}</Tag>;

export function Avatar({ name, src, size = 44 }: { name: string; src?: string | null; size?: number }) {
  return <div className={`avatar toned tone-${toneFor(name)}`} style={css({ '--size': size + 'px' })} aria-hidden>{src ? <img src={src} alt="" loading="lazy" /> : initials(name)}</div>;
}

export function LogoTile({ brand, size = 40 }: { brand: { logo: string | null; initials: string } | undefined; size?: number }) {
  return (
    <div className="logo-tile" style={{ width: size, height: size, fontSize: size * 0.36 }} aria-hidden>
      {brand?.logo ? <img src={brand.logo} alt="" /> : brand?.initials ?? 'GP'}
    </div>
  );
}

export function SectionHead({ title, count, action }: { title: string; count?: number; action?: ReactNode }) {
  return (
    <div className="section-head">
      <h2 className="kicker">{title}</h2>
      {count !== undefined && <span className="count">{count}</span>}
      {action && <span className="action">{action}</span>}
    </div>
  );
}

export function Empty({ icon: Icon, title, children }: { icon?: LucideIcon; title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <span className="empty-title">{Icon && <Icon size={16} />}{title}</span>
      {children && <span>{children}</span>}
    </div>
  );
}

export const Skeleton = ({ h = 64, n = 2 }: { h?: number; n?: number }) => (
  <div className="stack" style={css({ '--gap': '8px' })} aria-busy>
    {Array.from({ length: n }, (_, i) => <div key={i} className="skeleton" style={{ height: h }} />)}
  </div>
);

export function Notice({ tone = 'ink', icon: Icon, children }: { tone?: 'ink' | 'danger' | 'plain'; icon?: LucideIcon; children: ReactNode }) {
  return <div className={'notice' + (tone !== 'ink' ? ' ' + tone : '')} role={tone === 'danger' ? 'alert' : undefined}>{Icon && <Icon size={16} />}<span>{children}</span></div>;
}

/** Real, scannable QR rendered as crisp SVG. */
export function QR({ value, size = 200, dim }: { value: string; size?: number; dim?: boolean }) {
  const [svg, setSvg] = useState('');
  useEffect(() => {
    QRCode.toString(value, { type: 'svg', margin: 0, errorCorrectionLevel: 'M', color: { dark: '#1f2933', light: '#ffffff' } }).then(setSvg);
  }, [value]);
  return <div className={'qr' + (dim ? ' dim' : '')} style={css({ '--qr': size + 'px' })} role="img" aria-label="Pass QR code" dangerouslySetInnerHTML={{ __html: svg }} />;
}

// ── Sheet (bottom sheet on phones, dialog on wide screens) ───────────────────

export function Sheet({ title, sub, onClose, children, actions }: { title: string; sub?: ReactNode; onClose: () => void; children: ReactNode; actions?: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    ref.current?.querySelector<HTMLElement>('input, button:not(.sheet-close)')?.focus();
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = ''; prev?.focus?.(); };
  }, [onClose]);
  // Portal to <body>: ancestors with backdrop-filter (the sticky header) would otherwise trap position:fixed.
  return createPortal(
    <div className="backdrop" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="sheet" role="dialog" aria-modal="true" aria-labelledby={titleId} ref={ref}>
        <div className="sheet-grip" />
        <div className="sheet-head">
          <div className="grow stack" style={css({ '--gap': '4px' })}>
            <h2 className="sheet-title" id={titleId}>{title}</h2>
            {sub && <div className="meta">{sub}</div>}
          </div>
          <button className="icon-btn sheet-close" aria-label="Close" onClick={onClose}><X size={20} /></button>
        </div>
        {children}
        {actions && <div className="sheet-actions">{actions}</div>}
      </div>
    </div>,
    document.body,
  );
}
