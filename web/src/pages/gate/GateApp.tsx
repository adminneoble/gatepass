import { Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { House, ListChecks, ScanLine, Siren, UserPlus } from 'lucide-react';
import { AccountButton, AppHeader, TabBar } from '../../ui/shell';
import { useMe } from '../../lib/session';
import { plural } from '../../lib/format';
import { css } from '../../ui';
import { useOpenAlerts } from './data';
import GateHome from './GateHome';
import NewEntry from './NewEntry';
import Verify from './Verify';
import VisitorLog from './VisitorLog';
import { NoticeBoard, NoticesButton } from '../shared/Notices';

const TITLES: Record<string, string> = { '/gate': 'Main gate', '/gate/entry': 'New visitor', '/gate/verify': 'Verify pass', '/gate/log': "Today's visitors", '/gate/notices': 'Notices' };

export default function GateApp() {
  const { pathname } = useLocation();
  const nav = useNavigate();
  const brand = useMe().data?.society;
  const alerts = useOpenAlerts().data ?? [];
  const isHome = pathname === '/gate' || pathname === '/gate/';

  return (
    <div className="shell gate" style={css({ '--col': '960px' })}>
      <AppHeader kicker={`${brand?.name ?? ''} · Security`} title={TITLES[pathname.replace(/\/$/, '')] ?? 'Main gate'} actions={<div className="row" style={css({ '--gap': '0' })}><NoticesButton to="/gate/notices" /><AccountButton /></div>} />
      {!isHome && alerts.length > 0 && (
        <button className="alert-strip" onClick={() => nav('/gate')}>
          <Siren size={18} /><span>{plural(alerts.length, 'open resident alert')}</span><span className="go">View</span>
        </button>
      )}
      <Routes>
        <Route index element={<GateHome />} />
        <Route path="entry" element={<NewEntry />} />
        <Route path="verify" element={<Verify />} />
        <Route path="log" element={<VisitorLog />} />
        <Route path="notices" element={<NoticeBoard />} />
      </Routes>
      <TabBar tabs={[
        { to: '/gate', label: 'Home', icon: House, end: true },
        { to: '/gate/entry', label: 'New entry', icon: UserPlus },
        { to: '/gate/verify', label: 'Verify', icon: ScanLine },
        { to: '/gate/log', label: 'Log', icon: ListChecks },
      ]} />
    </div>
  );
}
