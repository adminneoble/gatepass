import { StrictMode, lazy, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import './styles/tokens.css';
import './styles/base.css';
import './styles/components.css';
import './styles/layout.css';
import './styles/lively.css';
import { ApiError } from './lib/api';
import { FeedbackProvider } from './lib/feedback';
import { homeFor, useMe } from './lib/session';
import { RequireRole, applyTheme } from './ui/shell';
import { Skeleton } from './ui';
import Login from './pages/Login';
import PassPage from './pages/PassPage';

const GateApp = lazy(() => import('./pages/gate/GateApp'));
const MemberApp = lazy(() => import('./pages/member/MemberApp'));
const AdminApp = lazy(() => import('./pages/admin/AdminApp'));
const DevSms = lazy(() => import('./pages/DevSms'));

applyTheme();

const qc = new QueryClient({
  defaultOptions: {
    queries: { retry: (n, e) => !(e instanceof ApiError && e.status < 500) && n < 2, refetchOnWindowFocus: true, staleTime: 10_000 },
  },
});

function Home() {
  const me = useMe();
  if (me.isLoading) return null;
  return <Navigate to={me.data?.user ? homeFor(me.data.user.roles) : '/login'} replace />;
}

const Loading = () => <div className="content shell-col"><Skeleton h={80} n={4} /></div>;

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={qc}>
      <BrowserRouter>
        <FeedbackProvider>
          <Suspense fallback={<Loading />}>
            <Routes>
              <Route path="/" element={<Home />} />
              <Route path="/login" element={<Login />} />
              <Route path="/p/:token" element={<PassPage />} />
              <Route path="/dev/sms" element={<DevSms />} />
              <Route path="/gate/*" element={<RequireRole role="security" source="Gatepass"><GateApp /></RequireRole>} />
              <Route path="/app/*" element={<RequireRole role="member" source="Gatepass"><MemberApp /></RequireRole>} />
              <Route path="/admin/*" element={<RequireRole role="admin" source="Gatepass"><AdminApp /></RequireRole>} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </Suspense>
        </FeedbackProvider>
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);
