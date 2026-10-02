import { createContext, useContext } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../lib/api';
import type { MyUnit, Visit } from '../../lib/types';

type Ctx = { unit: MyUnit; units: MyUnit[]; openSecurity: () => void };
export const UnitCtx = createContext<Ctx>(null!);
export const useUnit = () => useContext(UnitCtx);

export const useMyUnits = () => useQuery({ queryKey: ['units', 'mine'], queryFn: () => api.get<MyUnit[]>('/me/units') });
export const usePendingRequests = () => useQuery({ queryKey: ['visits', 'requests'], queryFn: () => api.get<Visit[]>('/me/requests') });
