import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { useFeedback } from './feedback';
import { useMe } from './session';

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const publishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined;
let client: SupabaseClient | null = null;
/** Supabase is used only for Realtime here; all data goes through /api. */
const supabase = () => (url && publishableKey ? (client ??= createClient(url, publishableKey, { auth: { persistSession: false, autoRefreshToken: false } })) : null);

/**
 * Subscribe to Supabase Realtime broadcasts on the channels the server assigned this user
 * (/auth/me → live). `invalidate` refetches the named query groups; `notify` shows a banner
 * (new walk-in, alert, approval…). Without Supabase config (offline dev) there are no live updates.
 */
export function useLive(enabled: boolean, source: string) {
  const qc = useQueryClient();
  const { banner } = useFeedback();
  const live = useMe().data?.live;
  const names = live ? [live.all, live.me, ...live.roles] : [];
  const channelKey = names.join(',');

  useEffect(() => {
    const sb = supabase();
    if (!enabled || !sb || !channelKey) return;
    let connected = false;
    const channels = channelKey.split(',').map(name => sb.channel(name)
      .on('broadcast', { event: 'invalidate' }, ({ payload }) => {
        for (const topic of (payload as { topics: string[] }).topics) qc.invalidateQueries({ queryKey: [topic] });
      })
      .on('broadcast', { event: 'notify' }, ({ payload }) => {
        const n = payload as { text: string; tone?: 'info' | 'alert'; link?: string };
        banner({ text: n.text, tone: n.tone ?? 'info', link: n.link, source });
      })
      .subscribe(status => {
        // After a reconnect, refetch everything that may have changed while offline.
        if (status === 'SUBSCRIBED' && name === live?.all) { if (connected) qc.invalidateQueries(); connected = true; }
      }));
    return () => { for (const c of channels) sb.removeChannel(c); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, channelKey, qc, banner, source]);
}
