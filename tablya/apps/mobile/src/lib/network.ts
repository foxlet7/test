import { QueryCache, QueryClient } from '@tanstack/react-query';
import { create } from 'zustand';
import { ApiError } from './api';

/** True while the most recent request failed for network reasons; cleared by any success. */
export const useNetwork = create<{ offline: boolean }>(() => ({ offline: false }));

export const queryClient = new QueryClient({
  queryCache: new QueryCache({
    onError: (e) => {
      if (e instanceof ApiError && e.isNetwork) useNetwork.setState({ offline: true });
    },
    onSuccess: () => useNetwork.setState({ offline: false }),
  }),
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      gcTime: 10 * 60_000,
      retry: (n, e) => !(e instanceof ApiError && e.status >= 400 && e.status < 500) && n < 2,
    },
    mutations: { retry: false },
  },
});
