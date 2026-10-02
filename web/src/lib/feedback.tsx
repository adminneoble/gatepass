import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bell, CircleAlert, Check, Siren } from 'lucide-react';
import { ApiError } from './api';

type Toast = { id: number; text: string; tone: 'info' | 'danger' };
type Banner = { id: number; text: string; tone: 'info' | 'alert'; link?: string; source: string };

type Ctx = {
  toast: (text: string, tone?: 'info' | 'danger') => void;
  banner: (b: Omit<Banner, 'id'>) => void;
  fail: (e: unknown) => void;
};
const FeedbackCtx = createContext<Ctx>(null!);
export const useFeedback = () => useContext(FeedbackCtx);

/** Toasts (bottom, ink) and notification banners (top, auto-hide 5 s) from the handoff. */
export function FeedbackProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [banners, setBanners] = useState<Banner[]>([]);
  const seq = useRef(0);
  const navigate = useNavigate();

  const toast = useCallback((text: string, tone: 'info' | 'danger' = 'info') => {
    const id = ++seq.current;
    setToasts(t => [...t.slice(-2), { id, text, tone }]);
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), 3500);
  }, []);
  const banner = useCallback((b: Omit<Banner, 'id'>) => {
    const id = ++seq.current;
    setBanners(x => [...x.slice(-1), { ...b, id }]);
    setTimeout(() => setBanners(x => x.filter(y => y.id !== id)), 5000);
    if (b.tone === 'alert' && 'vibrate' in navigator) navigator.vibrate?.([120, 60, 120]);
  }, []);
  const fail = useCallback((e: unknown) => toast(e instanceof ApiError || e instanceof Error ? e.message : 'Something went wrong.', 'danger'), [toast]);
  const value = useMemo(() => ({ toast, banner, fail }), [toast, banner, fail]);

  return (
    <FeedbackCtx.Provider value={value}>
      {children}
      <div className="banners" aria-live="assertive">
        {banners.map(b => (
          <button key={b.id} className={'banner' + (b.tone === 'alert' ? ' alert' : '')}
            onClick={() => { setBanners(x => x.filter(y => y.id !== b.id)); if (b.link) navigate(b.link); }}>
            {b.tone === 'alert' ? <Siren size={20} /> : <Bell size={20} />}
            <span className="stack" style={{ '--gap': '2px' } as React.CSSProperties}>
              <span className="banner-src">{b.source} · now</span>
              <span className="banner-text">{b.text}</span>
            </span>
          </button>
        ))}
      </div>
      <div className="toasts" aria-live="polite">
        {toasts.map(t => (
          <div key={t.id} className={'toast' + (t.tone === 'danger' ? ' danger' : '')} role="status">
            {t.tone === 'danger' ? <CircleAlert size={18} /> : <Check size={18} />}
            <span>{t.text}</span>
          </div>
        ))}
      </div>
    </FeedbackCtx.Provider>
  );
}
