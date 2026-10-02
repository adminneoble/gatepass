import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useFeedback } from './feedback';

/**
 * Subscribe to server-sent events. `invalidate` refetches the named query groups;
 * `notify` shows a banner (new walk-in, alert, approval…).
 */
export function useLive(enabled: boolean, source: string) {
  const qc = useQueryClient();
  const { banner } = useFeedback();
  useEffect(() => {
    if (!enabled) return;
    const es = new EventSource('/api/stream');
    es.addEventListener('invalidate', e => {
      for (const topic of JSON.parse((e as MessageEvent).data) as string[]) qc.invalidateQueries({ queryKey: [topic] });
    });
    es.addEventListener('notify', e => {
      const n = JSON.parse((e as MessageEvent).data) as { text: string; tone?: 'info' | 'alert'; link?: string };
      banner({ text: n.text, tone: n.tone ?? 'info', link: n.link, source });
    });
    // After a reconnect, refetch everything that may have changed while offline.
    let connected = false;
    es.addEventListener('open', () => { if (connected) qc.invalidateQueries(); connected = true; });
    return () => es.close();
  }, [enabled, qc, banner, source]);
}
