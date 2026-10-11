import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { api, authCall, loadSession, setSignedOutHandler, signOutRemote } from './api';
import { useLang } from './i18n';

export interface Me {
  id: string;
  profile: { pseudonym: string; ui_language: 'en' | 'ar'; tradition: 'islam' | 'christianity' | null; weekly_goal: number };
  consents: { type: string }[];
  memberships: string[];
}
interface Ctx { ready: boolean; me: Me | null; refreshMe: () => Promise<void>; signIn: (path: '/auth/login' | '/auth/register', body: unknown) => Promise<void>; signOut: () => Promise<void> }
const SessionContext = createContext<Ctx>(null as unknown as Ctx);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [me, setMe] = useState<Me | null>(null);
  const { setLang } = useLang();

  const refreshMe = useCallback(async () => {
    const m = await api<Me>('/me');
    setMe(m);
    setLang(m.profile.ui_language);
  }, [setLang]);

  useEffect(() => {
    setSignedOutHandler(() => setMe(null));
    (async () => {
      const s = await loadSession();
      if (s) { try { await refreshMe(); } catch { /* signed out below */ } }
      setReady(true);
    })();
  }, [refreshMe]);

  const value: Ctx = {
    ready, me, refreshMe,
    signIn: async (path, body) => { await authCall(path, body); await refreshMe(); },
    signOut: async () => { await signOutRemote(); setMe(null); },
  };
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}
export const useSession = () => useContext(SessionContext);
