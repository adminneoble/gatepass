import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './api';
import type { Brand, Society, User } from './types';

/** Realtime channel names for the signed-in user (see server lib/realtime.ts). */
export type LiveChannels = { all: string; me: string; roles: string[] };
type Me = { user: User | null; society: Brand; live?: LiveChannels };

export function useMe() {
  return useQuery({ queryKey: ['me'], queryFn: () => api.get<Me>('/auth/me'), staleTime: 60_000 });
}

export function useSociety() {
  return useQuery({ queryKey: ['society'], queryFn: () => api.get<Society>('/society'), staleTime: 60_000 });
}

export function useLogout() {
  const qc = useQueryClient();
  return async () => {
    await api.post('/auth/logout');
    qc.clear();
    location.href = '/login';
  };
}

export const homeFor = (roles: string[]) =>
  roles.includes('security') ? '/gate' : roles.includes('member') ? '/app' : roles.includes('admin') ? '/admin' : '/login';
