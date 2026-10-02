import { useState, type ReactNode } from 'react';
import { NavLink, Navigate, useNavigate } from 'react-router-dom';
import { CircleUser, LogOut, Monitor, Moon, Sun, type LucideIcon } from 'lucide-react';
import { useLogout, useMe } from '../lib/session';
import { useLive } from '../lib/live';
import { fmtMobile } from '../lib/format';
import type { Role } from '../lib/types';
import { Button, IconButton, LogoTile, Seg, Sheet, Skeleton, css } from '.';

export type TabDef = { to: string; label: string; icon: LucideIcon; badge?: number; end?: boolean };

/** Gate a role's area: sign-in, role check, and the live event stream. */
export function RequireRole({ role, source, children }: { role: Role; source: string; children: ReactNode }) {
  const me = useMe();
  const ok = !!me.data?.user?.roles.includes(role);
  useLive(ok, source);
  if (me.isLoading) return <div className="content shell-col"><Skeleton h={80} n={4} /></div>;
  if (!me.data?.user) return <Navigate to="/login" replace />;
  if (!ok) return <Navigate to="/" replace />;
  return <>{children}</>;
}

export function AppHeader({ kicker, title, actions, className = '' }: { kicker: string; title: string; actions?: ReactNode; className?: string }) {
  const brand = useMe().data?.society;
  return (
    <header className={'app-header ' + className}>
      <div className="app-header-inner shell-col">
        <LogoTile brand={brand} />
        <div className="titles">
          <span className="kicker ellipsis">{kicker}</span>
          <h1 className="title">{title}</h1>
        </div>
        {actions}
      </div>
    </header>
  );
}

export function TabBar({ tabs }: { tabs: TabDef[] }) {
  return (
    <nav className="tabbar" aria-label="Sections">
      <div className="tabbar-inner">
        {tabs.map(t => (
          <NavLink key={t.to} to={t.to} end={t.end} className="tab">
            <t.icon size={20} strokeWidth={2} />
            <span>{t.label}</span>
            {!!t.badge && <span className="badge">{t.badge}</span>}
          </NavLink>
        ))}
      </div>
    </nav>
  );
}

const ROLE_HOME: Record<Role, [string, string]> = { security: ['/gate', 'Security · gate'], member: ['/app', 'Resident'], admin: ['/admin', 'Admin'] };
type Theme = 'Auto' | 'Light' | 'Dark';
const readTheme = (): Theme => { try { return (localStorage.getItem('gp-theme') as Theme) || 'Auto'; } catch { return 'Auto'; } };
export function applyTheme(t: Theme = readTheme()) {
  if (t === 'Auto') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = t.toLowerCase();
}

/** Account button + sheet: who's signed in, switch role areas, theme, sign out. */
export function AccountButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <IconButton icon={CircleUser} label="Account" onClick={() => setOpen(true)} />
      {open && <AccountSheet onClose={() => setOpen(false)} />}
    </>
  );
}

function AccountSheet({ onClose }: { onClose: () => void }) {
  const user = useMe().data?.user;
  const logout = useLogout();
  const nav = useNavigate();
  const [theme, setTheme] = useState<Theme>(readTheme);
  if (!user) return null;
  return (
    <Sheet title={user.name} sub={fmtMobile(user.mobile)} onClose={onClose}>
      {user.roles.length > 1 && (
        <div className="stack" style={css({ '--gap': '8px' })}>
          <span className="field-label">Open</span>
          {user.roles.map(r => (
            <Button key={r} block onClick={() => { onClose(); nav(ROLE_HOME[r][0]); }}>{ROLE_HOME[r][1]}</Button>
          ))}
        </div>
      )}
      <div className="stack" style={css({ '--gap': '8px' })}>
        <span className="field-label">Appearance</span>
        <div className="row" style={css({ '--gap': '8px' })}>
          {theme === 'Dark' ? <Moon size={18} /> : theme === 'Light' ? <Sun size={18} /> : <Monitor size={18} />}
          <Seg label="Theme" options={['Auto', 'Light', 'Dark'] as const} value={theme}
            onChange={t => { setTheme(t); try { localStorage.setItem('gp-theme', t); } catch { /* private mode */ } applyTheme(t); }} />
        </div>
      </div>
      <div className="sheet-actions">
        <Button variant="primary" size="lg" icon={LogOut} onClick={logout}>Sign out</Button>
        <Button size="lg" onClick={onClose}>Cancel</Button>
      </div>
    </Sheet>
  );
}

/** Confirm before signing out, with a way back. */
export function SignOutSheet({ onClose }: { onClose: () => void }) {
  const logout = useLogout();
  return (
    <Sheet title="Sign out of Gatepass?" sub="You'll need a code sent to your mobile to sign in again." onClose={onClose}
      actions={<>
        <Button variant="primary" size="lg" icon={LogOut} onClick={logout}>Sign out</Button>
        <Button size="lg" onClick={onClose}>Cancel</Button>
      </>}>
      {null}
    </Sheet>
  );
}
