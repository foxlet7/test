export interface ApiErrorBody {
  code: string;
  message: string;
  details?: unknown;
  requestId?: string;
}
export class ApiError extends Error {
  constructor(
    public status: number,
    public body: ApiErrorBody,
  ) {
    super(body.message);
  }
}

const BASE = import.meta.env.VITE_API_URL ?? '/api';
const KEY = 'tablya.admin.session';

export interface Session {
  accessToken: string;
  refreshToken: string;
  user: { id: string; name: string; roles: string[]; email: string | null };
}

// sessionStorage (not localStorage): the session dies with the tab, which suits a privileged console.
export const sessionStore = {
  get(): Session | null {
    try {
      return JSON.parse(sessionStorage.getItem(KEY) ?? 'null');
    } catch {
      return null;
    }
  },
  set(s: Session | null) {
    try {
      if (s) sessionStorage.setItem(KEY, JSON.stringify(s));
      else sessionStorage.removeItem(KEY);
    } catch {
      /* storage unavailable: session lives in memory only */
    }
  },
};

let refreshing: Promise<boolean> | null = null;
let onLogout: () => void = () => undefined;
export const setLogoutHandler = (fn: () => void) => (onLogout = fn);

async function refresh(): Promise<boolean> {
  const s = sessionStore.get();
  if (!s) return false;
  refreshing ??= fetch(`${BASE}/auth/refresh`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ refreshToken: s.refreshToken }),
  })
    .then(async (r) => {
      if (!r.ok) return false;
      const j = await r.json();
      sessionStore.set({ ...s, accessToken: j.data.accessToken, refreshToken: j.data.refreshToken });
      return true;
    })
    .catch(() => false)
    .finally(() => {
      refreshing = null;
    });
  return refreshing;
}

export async function api<T = unknown>(
  path: string,
  opts: { method?: string; body?: unknown; headers?: Record<string, string>; retry?: boolean } = {},
): Promise<T> {
  const s = sessionStore.get();
  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, {
      method: opts.method ?? 'GET',
      headers: {
        ...(opts.body !== undefined ? { 'content-type': 'application/json' } : {}),
        ...(s ? { authorization: `Bearer ${s.accessToken}` } : {}),
        ...opts.headers,
      },
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      signal: AbortSignal.timeout(20_000),
    });
  } catch {
    throw new ApiError(0, { code: 'NETWORK', message: 'Network error or timeout' });
  }
  if ((res.status === 401) && s && opts.retry !== false && (await refresh())) return api<T>(path, { ...opts, retry: false });
  const json = await res.json().catch(() => null);
  if (!res.ok || !json?.success) {
    if (res.status === 401 && s) {
      sessionStore.set(null);
      onLogout();
    }
    throw new ApiError(res.status, json?.error ?? { code: 'INTERNAL', message: 'Unexpected response' });
  }
  return json.data as T;
}

export const newKey = () => crypto.randomUUID();
