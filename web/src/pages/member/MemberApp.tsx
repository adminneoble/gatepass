import { useEffect, useState } from 'react';
import { Route, Routes, useLocation } from 'react-router-dom';
import { Bell, Building2, History, ShieldAlert, Ticket, UserCheck } from 'lucide-react';
import { useMe } from '../../lib/session';
import type { MyUnit } from '../../lib/types';
import { UnitCtx, useMyUnits, usePendingRequests } from './context';
import { AccountButton, AppHeader, TabBar } from '../../ui/shell';
import { IconButton, Skeleton, css } from '../../ui';
import { ContactSecuritySheet, NotificationsSheet, useNotifications } from './sheets';
import Requests from './Requests';
import Invite from './Invite';
import Units from './Units';
import Activity from '../shared/Activity';
import { NoticeBoard, NoticesButton } from '../shared/Notices';


const TITLES: Record<string, string> = { '': 'Visitors', invite: 'Pre-approve', activity: 'Activity', units: 'My units', notices: 'Notices' };

const roleLabel = (u: MyUnit) => (!u.isOwner ? 'Tenant' : u.tenant ? `Rented · ${u.tenant.name}` : 'Home');

export default function MemberApp() {
  const me = useMe().data?.user;
  const units = useMyUnits();
  const pending = usePendingRequests().data ?? [];
  const notes = useNotifications().data;
  const { pathname } = useLocation();
  const [sheet, setSheet] = useState<'security' | 'notes' | null>(null);
  const [unitId, setUnitId] = useState(() => { try { return localStorage.getItem('gp-unit') ?? ''; } catch { return ''; } });

  const list = units.data ?? [];
  const unit = list.find(u => u.id === unitId) ?? list[0];
  useEffect(() => { if (unit) try { localStorage.setItem('gp-unit', unit.id); } catch { /* ignore */ } }, [unit]);

  const tab = pathname.replace(/^\/app\/?/, '').split('/')[0];

  return (
    <div className="shell" style={css({ '--col': '560px' })}>
      <AppHeader
        kicker={`${me?.name ?? ''}${unit ? ' · ' + unit.id : ''}`}
        title={TITLES[tab] ?? 'Visitors'}
        actions={<div className="row" style={css({ '--gap': '0' })}>
          <NoticesButton to="/app/notices" />
          <IconButton icon={ShieldAlert} label="Contact security" onClick={() => setSheet('security')} />
          <IconButton icon={Bell} label="Notifications" badge={notes?.unread} onClick={() => setSheet('notes')} />
          <AccountButton />
        </div>}
      />
      {list.length > 0 && (
        <div className="unit-strip" role="tablist" aria-label="Your units">
          <div className="shell-col row" style={css({ '--gap': '0' })}>
            {list.map(u => (
              <button key={u.id} role="tab" aria-selected={u.id === unit?.id} className="unit-tab" onClick={() => setUnitId(u.id)}>
                <span className="u-id">{u.id}</span><span className="u-role">{roleLabel(u)}</span>
              </button>
            ))}
          </div>
        </div>
      )}
      {!unit ? <div className="content shell-col"><Skeleton h={90} n={3} /></div> : (
        <UnitCtx.Provider value={{ unit, units: list, openSecurity: () => setSheet('security') }}>
          <Routes>
            <Route index element={<Requests />} />
            <Route path="invite" element={<Invite />} />
            <Route path="activity" element={<main className="content shell-col"><Activity unit={unit.id} /></main>} />
            <Route path="units" element={<Units />} />
            <Route path="notices" element={<NoticeBoard />} />
          </Routes>
          {sheet === 'security' && <ContactSecuritySheet onClose={() => setSheet(null)} />}
        </UnitCtx.Provider>
      )}
      {sheet === 'notes' && <NotificationsSheet onClose={() => setSheet(null)} />}
      <TabBar tabs={[
        { to: '/app', label: 'Requests', icon: UserCheck, end: true, badge: pending.length },
        { to: '/app/invite', label: 'Invite', icon: Ticket },
        { to: '/app/activity', label: 'Activity', icon: History },
        { to: '/app/units', label: 'Units', icon: Building2 },
      ]} />
    </div>
  );
}
