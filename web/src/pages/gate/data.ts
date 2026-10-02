import { useMutation, useQuery } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { useFeedback } from '../../lib/feedback';
import type { GateAlert, Visit } from '../../lib/types';

export type GateVisits = { visits: Visit[]; stats: { inside: number; atGate: number; exited: number; denied: number; total: number } };

export const useGateVisits = () => useQuery({ queryKey: ['visits', 'gate'], queryFn: () => api.get<GateVisits>('/visits'), refetchInterval: 60_000 });
export const useOpenAlerts = () => useQuery({ queryKey: ['alerts', 'open'], queryFn: () => api.get<GateAlert[]>('/alerts/open') });

/** Allow in / mark exit, with toast feedback. Live updates refresh the lists. */
export function useVisitAction() {
  const { toast, fail } = useFeedback();
  return useMutation({
    mutationFn: ({ v, action }: { v: Visit; action: 'enter' | 'exit' }) => api.post(`/visits/${v.id}/${action}`),
    onSuccess: (_d, { v, action }) => toast(action === 'enter' ? `${v.name} checked in` : `${v.name} marked as exited`),
    onError: fail,
  });
}
