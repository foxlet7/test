import Constants from 'expo-constants';
import { storage } from './storage';

/** The Android test shell injects the server URL at runtime (`/__config.js`); otherwise it is the build-time value. */
const injectedApiUrl = (globalThis as { __TABLYA_API_URL__?: string }).__TABLYA_API_URL__;
export const API_URL: string =
  injectedApiUrl ??
  process.env.EXPO_PUBLIC_API_URL ??
  (Constants.expoConfig?.extra?.apiUrl as string) ??
  'http://localhost:3000';
const TIMEOUT_MS = 15_000;
const K_ACCESS = 'tablya.access';
const K_REFRESH = 'tablya.refresh';

export interface ApiErrorBody {
  code: string;
  message: string;
  details?: any;
  requestId?: string;
}
export class ApiError extends Error {
  constructor(
    public status: number,
    public body: ApiErrorBody,
  ) {
    super(body.message);
  }
  get isNetwork() {
    return this.body.code === 'NETWORK' || this.body.code === 'TIMEOUT';
  }
}

let accessToken: string | null = null;
let refreshToken: string | null = null;
let loaded = false;
let onSessionLost: () => void = () => undefined;
export const setSessionLostHandler = (fn: () => void) => (onSessionLost = fn);

export async function loadTokens() {
  if (loaded) return;
  [accessToken, refreshToken] = await Promise.all([storage.get(K_ACCESS), storage.get(K_REFRESH)]);
  loaded = true;
}
export async function setTokens(a: string | null, r: string | null) {
  accessToken = a;
  refreshToken = r;
  loaded = true;
  if (a && r) await Promise.all([storage.set(K_ACCESS, a), storage.set(K_REFRESH, r)]);
  else await Promise.all([storage.remove(K_ACCESS), storage.remove(K_REFRESH)]);
}
export const hasTokens = () => !!refreshToken;

async function raw(path: string, init: RequestInit & { token?: string | null }): Promise<Response> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    return await fetch(`${API_URL}${path}`, { ...init, signal: ctl.signal });
  } catch (e) {
    throw new ApiError(0, {
      code: (e as Error).name === 'AbortError' ? 'TIMEOUT' : 'NETWORK',
      message: 'Network error',
    });
  } finally {
    clearTimeout(timer);
  }
}

let refreshing: Promise<boolean> | null = null;
function refresh(): Promise<boolean> {
  if (!refreshToken) return Promise.resolve(false);
  refreshing ??= (async () => {
    try {
      const res = await raw('/auth/refresh', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ refreshToken }),
      });
      if (!res.ok) return false;
      const j = await res.json();
      await setTokens(j.data.accessToken, j.data.refreshToken);
      return true;
    } catch {
      return false; // offline: keep tokens, the next call will retry
    } finally {
      refreshing = null;
    }
  })();
  return refreshing;
}

export interface RequestOpts {
  method?: string;
  body?: unknown;
  form?: FormData;
  headers?: Record<string, string>;
  auth?: boolean;
}

export async function api<T = any>(
  path: string,
  opts: RequestOpts = {},
  retried = false,
): Promise<T> {
  await loadTokens();
  const headers: Record<string, string> = {
    ...(opts.body !== undefined ? { 'content-type': 'application/json' } : {}),
    ...opts.headers,
  };
  if (opts.auth !== false && accessToken) headers.authorization = `Bearer ${accessToken}`;
  const res = await raw(path, {
    method: opts.method ?? 'GET',
    headers,
    body: opts.form ?? (opts.body !== undefined ? JSON.stringify(opts.body) : undefined),
  });
  if (res.status === 401 && opts.auth !== false && !retried && refreshToken) {
    if (await refresh()) return api<T>(path, opts, true);
    if (refreshToken && !refreshing) {
      // refresh was rejected (not just offline): the session is gone
      const stillThere = await raw('/health', {})
        .then((r) => r.ok)
        .catch(() => false);
      if (stillThere) {
        await setTokens(null, null);
        onSessionLost();
      }
    }
  }
  const json = await res.json().catch(() => null);
  if (!res.ok || !json?.success)
    throw new ApiError(
      res.status,
      json?.error ?? { code: 'INTERNAL', message: 'Unexpected response' },
    );
  return json.data as T;
}

/** Random idempotency key (UUID v4). Generate once per user intent and reuse on retries. */
export function newIdempotencyKey(): string {
  const c = globalThis.crypto as Crypto | undefined;
  if (c?.randomUUID) return c.randomUUID();
  const b = Array.from({ length: 16 }, () => Math.floor(Math.random() * 256));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = b.map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
