'use client';

const BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8080';

/** Tokens live in sessionStorage (cleared when the tab closes). Staff sessions are short; the CSP blocks third-party scripts. */
export interface Session { accessToken: string; refreshToken: string; roles: string[] }
const KEY = 'gdc_admin_session';

export function getSession(): Session | null {
  try { return JSON.parse(sessionStorage.getItem(KEY) ?? 'null'); } catch { return null; }
}
export function setSession(s: Session | null) {
  try { s ? sessionStorage.setItem(KEY, JSON.stringify(s)) : sessionStorage.removeItem(KEY); } catch { /* storage unavailable */ }
}

export class ApiError extends Error {
  constructor(public status: number, public code: string) { super(code); }
}

async function raw(path: string, init: RequestInit = {}, token?: string) {
  const headers: Record<string, string> = { ...(init.headers as Record<string, string>) };
  if (init.body) headers['content-type'] = 'application/json';
  if (token) headers.authorization = `Bearer ${token}`;
  return fetch(`${BASE}${path}`, { ...init, headers });
}

let refreshing: Promise<boolean> | null = null;
async function refresh(): Promise<boolean> {
  const s = getSession();
  if (!s) return false;
  refreshing ??= (async () => {
    const r = await raw('/auth/refresh', { method: 'POST', body: JSON.stringify({ refreshToken: s.refreshToken }) });
    if (!r.ok) { setSession(null); return false; }
    const j = await r.json();
    setSession({ accessToken: j.accessToken, refreshToken: j.refreshToken, roles: j.roles });
    return true;
  })().finally(() => { refreshing = null; });
  return refreshing;
}

export async function api<T = any>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const { json, ...rest } = init;
  const body = json !== undefined ? JSON.stringify(json) : rest.body;
  const call = () => raw(path, { ...rest, body }, getSession()?.accessToken);
  let r = await call();
  if (r.status === 401 && (await refresh())) r = await call();
  const text = await r.text();
  const data = text ? JSON.parse(text) : null;
  if (!r.ok) throw new ApiError(r.status, data?.error?.code ?? 'error');
  return data as T;
}

export async function login(email: string, password: string): Promise<Session> {
  const r = await raw('/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) });
  const j = await r.json();
  if (!r.ok) throw new ApiError(r.status, j?.error?.code ?? 'error');
  const s = { accessToken: j.accessToken, refreshToken: j.refreshToken, roles: j.roles as string[] };
  if (!s.roles.length) throw new ApiError(403, 'not_staff');
  setSession(s);
  return s;
}

export async function logout() {
  const s = getSession();
  if (s) await raw('/auth/logout', { method: 'POST', body: JSON.stringify({ refreshToken: s.refreshToken }) }).catch(() => {});
  setSession(null);
}

/** Fetch reviewer audio via a short-lived signed URL and expose it as a blob. */
export async function audioBlobUrl(taskId: number): Promise<string> {
  const { url } = await api<{ url: string }>(`/review/tasks/${taskId}/audio-url`, { method: 'POST' });
  const r = await fetch(`${BASE}${url}`);
  if (!r.ok) throw new ApiError(r.status, 'audio_unavailable');
  return URL.createObjectURL(await r.blob());
}
