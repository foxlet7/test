import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '../api';

export interface Paged<T> { items: T[]; total: number; page: number; pageSize: number }

/** Paged list with filters, previous-data retention and retry. */
export function useList<T>(path: string, filters: Record<string, string | undefined> = {}) {
  const [page, setPage] = useState(1);
  const qs = new URLSearchParams({ page: String(page), ...Object.fromEntries(Object.entries(filters).filter(([, v]) => v)) as Record<string, string> });
  const q = useQuery({ queryKey: [path, page, filters], queryFn: () => api<Paged<T>>(`${path}?${qs}`), placeholderData: keepPreviousData });
  return { ...q, page, setPage };
}
