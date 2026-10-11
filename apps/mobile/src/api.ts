import * as SecureStore from 'expo-secure-store';
import { API_URL } from './config';

export class ApiError extends Error {
  constructor(public status: number, public code: string) { super(code); }
}

export interface Session { accessToken: string; refreshToken: string; userId: string }
const KEY = 'gdc_session';
let session: Session | null = null;
let onSignedOut: (() => void) | null = null;

export const setSignedOutHandler = (fn: () => void) => { onSignedOut = fn; };

export async function loadSession(): Promise<Session | null> {
  try { session = JSON.parse((await SecureStore.getItemAsync(KEY)) ?? 'null'); } catch { session = null; }
  return session;
}
export async function saveSession(s: Session | null) {
  session = s;
  try { s ? await SecureStore.setItemAsync(KEY, JSON.stringify(s)) : await SecureStore.deleteItemAsync(KEY); } catch { /* keychain unavailable */ }
}

async function rawFetch(path: string, init: RequestInit, token?: string) {
  const headers: Record<string, string> = { ...(init.headers as Record<string, string>) };
  if (typeof init.body === 'string') headers['content-type'] = 'application/json';
  if (token) headers.authorization = `Bearer ${token}`;
  return fetch(`${API_URL}${path}`, { ...init, headers });
}

let refreshing: Promise<boolean> | null = null;
async function refresh(): Promise<boolean> {
  if (!session) return false;
  const rt = session.refreshToken;
  refreshing ??= (async () => {
    try {
      const r = await rawFetch('/auth/refresh', { method: 'POST', body: JSON.stringify({ refreshToken: rt }) });
      if (!r.ok) { await saveSession(null); onSignedOut?.(); return false; }
      const j = await r.json();
      await saveSession({ accessToken: j.accessToken, refreshToken: j.refreshToken, userId: j.userId });
      return true;
    } catch { return false; }
  })().finally(() => { refreshing = null; });
  return refreshing;
}

export async function api<T = any>(path: string, opts: { method?: string; json?: unknown; form?: FormData } = {}): Promise<T> {
  const init: RequestInit = { method: opts.method ?? (opts.json || opts.form ? 'POST' : 'GET') };
  if (opts.json !== undefined) init.body = JSON.stringify(opts.json);
  if (opts.form) init.body = opts.form as any;
  const call = () => rawFetch(path, init, session?.accessToken);
  let r: Response;
  try { r = await call(); } catch { throw new ApiError(0, 'network'); }
  if (r.status === 401 && session && (await refresh())) r = await call();
  const text = await r.text();
  let data: any = null;
  try { data = text ? JSON.parse(text) : null; } catch { /* non-json */ }
  if (!r.ok) throw new ApiError(r.status, data?.error?.code ?? 'error');
  return data as T;
}

export async function authCall(path: '/auth/login' | '/auth/register', body: unknown): Promise<Session> {
  const r = await rawFetch(path, { method: 'POST', body: JSON.stringify(body) });
  const j = await r.json().catch(() => null);
  if (!r.ok) throw new ApiError(r.status, j?.error?.code ?? 'error');
  const s = { accessToken: j.accessToken, refreshToken: j.refreshToken, userId: j.userId };
  await saveSession(s);
  return s;
}

export async function signOutRemote() {
  if (session) await rawFetch('/auth/logout', { method: 'POST', body: JSON.stringify({ refreshToken: session.refreshToken }) }).catch(() => {});
  await saveSession(null);
}
