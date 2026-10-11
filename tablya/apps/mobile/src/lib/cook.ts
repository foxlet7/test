import { useQuery } from '@tanstack/react-query';
import { api } from './api';

export interface CookKitchen {
  id: string;
  name: string;
  nameAr: string | null;
  verification: 'DRAFT' | 'SUBMITTED' | 'UNDER_REVIEW' | 'VERIFIED' | 'REJECTED' | 'SUSPENDED';
  verificationNote: string | null;
  acceptingOrders: boolean;
  pausedUntil: string | null;
  coverUrl: string | null;
  schedule: unknown[];
  zones: unknown[];
}

/** The signed-in cook's (first) kitchen, or null when onboarding hasn't started. */
export function useCookKitchen() {
  const q = useQuery({
    queryKey: ['cook-kitchens'],
    queryFn: () => api<CookKitchen[]>('/cook/kitchens'),
  });
  return { ...q, kitchen: q.data?.[0] ?? null };
}
