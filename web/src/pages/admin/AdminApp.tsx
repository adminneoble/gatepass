import { useState } from 'react';
import { NavLink, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Building2, History, LogOut, Megaphone, SlidersHorizontal } from 'lucide-react';
import { api } from '../../lib/api';
import { useMe } from '../../lib/session';
import { fmtMobile } from '../../lib/format';
import type { TenantRequest } from '../../lib/types';
import { AccountButton, AppHeader, SignOutSheet, TabBar } from '../../ui/shell';
import { Button, LogoTile, css } from '../../ui';
import Settings from './Settings';
import Directory from './Directory';
import Activity from '../shared/Activity';
import AdminNotices from './AdminNotices';

export const useTenantRequests = () => useQuery({ queryKey: ['requests', 'admin'], queryFn: () => api.get<TenantRequest[]>('/admin/tenant-requests') });

const TITLES: Record<string, [string, string]> = {
  settings: ['Gate settings', 'Rules every app follows'],
  directory: ['Unit directory', 'Owners, tenants and where requests go'],
  activity: ['All activity', 'Every unit, every event'],
  notices: ['Notices', 'Announcements to residents and security'],
};

export default function AdminApp() {
  const me = useMe().data;
  const [signingOut, setSigningOut] = useState(false);
  const reqs = useTenantRequests().data?.length ?? 0;
  const tab = useLocation().pathname.replace(/^\/admin\/?/, '').split('/')[0] || 'settings';
  const [title, sub] = TITLES[tab] ?? TITLES.settings;
  const nav = [
    { to: '/admin/settings', label: 'Settings', icon: SlidersHorizontal },
    { to: '/admin/directory', label: 'Directory', icon: Building2, badge: reqs },
    { to: '/admin/notices', label: 'Notices', icon: Megaphone },
    { to: '/admin/activity', label: 'Activity', icon: History },
  ];

  return (
    <div className="admin">
      <aside className="admin-side">
        <div className="brand">
          <LogoTile brand={me?.society} size={44} />
          <div className="stack" style={css({ '--gap': '0', minWidth: 0 })}>
            <span className="kicker">Admin</span>
            <span className="title-sm ellipsis">{me?.society.name}</span>
          </div>
        </div>
        {nav.map(n => (
          <NavLink key={n.to} to={n.to} className="side-link"><n.icon size={18} />{n.label}{!!n.badge && <span className="count">{n.badge}</span>}</NavLink>
        ))}
        <div className="foot">
          <div className="stack" style={css({ '--gap': '0', padding: '0 12px' })}>
            <span style={{ fontWeight: 700, fontSize: 14 }}>{me?.user?.name}</span>
            <span className="micro num">{fmtMobile(me?.user?.mobile)}</span>
          </div>
          <Button variant="ghost" icon={LogOut} onClick={() => setSigningOut(true)}>Sign out</Button>
          {signingOut && <SignOutSheet onClose={() => setSigningOut(false)} />}
        </div>
      </aside>

      <div className="shell" style={css({ '--col': '640px' })}>
        <AppHeader className="admin-mobile" kicker={`${me?.society.name ?? ''} · Admin`} title={title} actions={<AccountButton />} />
        <main className="content shell-col admin-content">
          <div className="page-head admin-desktop-only">
            <div className="grow stack" style={css({ '--gap': '4px' })}>
              <span className="kicker">{sub}</span>
              <h1 className="title-lg">{title}</h1>
            </div>
          </div>
          <Routes>
            <Route index element={<Navigate to="settings" replace />} />
            <Route path="settings" element={<Settings />} />
            <Route path="directory" element={<Directory />} />
            <Route path="activity" element={<Activity detailed />} />
            <Route path="notices" element={<AdminNotices />} />
          </Routes>
        </main>
        <TabBar tabs={nav} />
      </div>
    </div>
  );
}
