'use client';
import { useCallback, useEffect, useState } from 'react';
import { api } from './api';

export function useApi<T = any>(path: string | null) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(!!path);
  const reload = useCallback(async () => {
    if (!path) return;
    setLoading(true);
    try { setData(await api<T>(path)); setError(''); } catch (e: any) { setError(e.code ?? 'error'); }
    setLoading(false);
  }, [path]);
  useEffect(() => { void reload(); }, [reload]);
  return { data, error, loading, reload };
}

export async function act(fn: () => Promise<unknown>, onDone?: () => void): Promise<string> {
  try { await fn(); onDone?.(); return ''; } catch (e: any) { return e.code ?? 'error'; }
}
