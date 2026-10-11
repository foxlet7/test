import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { api, sessionStore, setLogoutHandler, type Session } from './api';

const STAFF = ['SUPPORT', 'MODERATOR', 'ADMIN', 'SUPER_ADMIN'];
const IDLE_MS = 15 * 60_000;

interface AuthCtx {
  session: Session | null;
  roles: string[];
  can(...roles: string[]): boolean;
  login(email: string, password: string, totp?: string): Promise<void>;
  logout(): Promise<void>;
  completeMfaSetup(): void;
}
const Ctx = createContext<AuthCtx>(null as unknown as AuthCtx);
export const useAuth = () => useContext(Ctx);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(() => sessionStore.get());
  const idle = useRef<number | undefined>(undefined);

  const clear = useCallback(() => {
    sessionStore.set(null);
    setSession(null);
  }, []);
  useEffect(() => setLogoutHandler(clear), [clear]);

  const logout = useCallback(async () => {
    try {
      await api('/auth/logout', { method: 'POST', retry: false });
    } catch {
      /* session may already be dead */
    }
    clear();
  }, [clear]);

  // Session timeout after inactivity (privileged console).
  useEffect(() => {
    if (!session) return;
    const reset = () => {
      window.clearTimeout(idle.current);
      idle.current = window.setTimeout(() => void logout(), IDLE_MS);
    };
    const evts = ['mousemove', 'keydown', 'click', 'touchstart'] as const;
    evts.forEach((e) => window.addEventListener(e, reset, { passive: true }));
    reset();
    return () => {
      evts.forEach((e) => window.removeEventListener(e, reset));
      window.clearTimeout(idle.current);
    };
  }, [session, logout]);

  const login = useCallback(async (email: string, password: string, totp?: string) => {
    const r = await api<{
      user: Session['user'];
      tokens: { accessToken: string; refreshToken: string };
      mfaSetupRequired?: boolean;
    }>('/auth/login', {
      method: 'POST',
      body: { email, password, ...(totp ? { totp } : {}) },
      retry: false,
    });
    if (!r.user.roles.some((x) => STAFF.includes(x))) {
      // Don't leave a live customer session behind on the server.
      await fetch(`${import.meta.env.VITE_API_URL ?? '/api'}/auth/logout`, {
        method: 'POST',
        headers: { authorization: `Bearer ${r.tokens.accessToken}` },
      }).catch(() => undefined);
      throw Object.assign(new Error('staff-only'), { staffOnly: true });
    }
    const s: Session = {
      accessToken: r.tokens.accessToken,
      refreshToken: r.tokens.refreshToken,
      user: r.user,
      ...(r.mfaSetupRequired ? { mfaSetup: true } : {}),
    };
    sessionStore.set(s);
    setSession(s);
  }, []);

  const completeMfaSetup = useCallback(() => {
    const cur = sessionStore.get();
    if (!cur) return;
    const next = { ...cur, mfaSetup: false };
    sessionStore.set(next);
    setSession(next);
  }, []);

  const roles = session?.user.roles ?? [];
  const can = (...want: string[]) =>
    roles.includes('SUPER_ADMIN') || want.some((w) => roles.includes(w));
  return (
    <Ctx.Provider value={{ session, roles, can, login, logout, completeMfaSetup }}>
      {children}
    </Ctx.Provider>
  );
}
