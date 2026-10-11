import { create } from 'zustand';
import { api, hasTokens, loadTokens, setSessionLostHandler, setTokens } from './api';

export interface User {
  id: string;
  email: string | null;
  phone: string | null;
  name: string;
  roles: string[];
  locale: string;
  emailVerified: boolean;
  phoneVerified: boolean;
}

interface AuthState {
  status: 'loading' | 'out' | 'in';
  user: User | null;
  init(): Promise<void>;
  login(email: string, password: string): Promise<void>;
  register(input: {
    email: string;
    password: string;
    name: string;
    phone?: string;
    role: 'CUSTOMER' | 'COOK';
    locale: 'en' | 'ar';
  }): Promise<void>;
  logout(): Promise<void>;
  refreshUser(): Promise<void>;
  clear(): void;
}

type AuthResponse = { user: User; tokens: { accessToken: string; refreshToken: string } };

export const useAuth = create<AuthState>((set, get) => ({
  status: 'loading',
  user: null,
  async init() {
    setSessionLostHandler(() => get().clear());
    await loadTokens();
    if (!hasTokens()) return set({ status: 'out' });
    try {
      set({ user: await api<User>('/me'), status: 'in' });
    } catch (e: any) {
      // Offline at launch must not log the user out; only a definitive auth failure does.
      if (e?.isNetwork && hasTokens()) set({ status: 'in' });
      else {
        await setTokens(null, null);
        set({ status: 'out', user: null });
      }
    }
  },
  async login(email, password) {
    const r = await api<AuthResponse>('/auth/login', {
      method: 'POST',
      body: { email, password },
      auth: false,
    });
    await setTokens(r.tokens.accessToken, r.tokens.refreshToken);
    set({ user: r.user, status: 'in' });
  },
  async register(input) {
    const r = await api<AuthResponse>('/auth/register', {
      method: 'POST',
      body: input,
      auth: false,
    });
    await setTokens(r.tokens.accessToken, r.tokens.refreshToken);
    set({ user: r.user, status: 'in' });
  },
  async logout() {
    try {
      await api('/auth/logout', { method: 'POST' });
    } catch {
      /* revoke best-effort; local tokens are removed regardless */
    }
    get().clear();
  },
  async refreshUser() {
    set({ user: await api<User>('/me') });
  },
  clear() {
    void setTokens(null, null);
    set({ status: 'out', user: null });
  },
}));

export const isCook = (u: User | null) =>
  !!u?.roles.some((r) => r === 'COOK' || r === 'KITCHEN_MANAGER');
