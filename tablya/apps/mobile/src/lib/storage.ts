import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';

/**
 * Secret/credential storage. Native: Keychain / Keystore via expo-secure-store.
 * Web is only used for local development previews and falls back to sessionStorage (never shipped to stores).
 */
/** Inside the Android test shell the web store must survive app restarts; plain browsers get a per-tab store. */
const webStore = () =>
  (globalThis as { TablyaShell?: unknown }).TablyaShell
    ? globalThis.localStorage
    : globalThis.sessionStorage;

export const storage = {
  async get(key: string): Promise<string | null> {
    try {
      if (Platform.OS === 'web') return webStore()?.getItem(key) ?? null;
      return await SecureStore.getItemAsync(key);
    } catch {
      return null;
    }
  },
  async set(key: string, value: string): Promise<void> {
    try {
      if (Platform.OS === 'web') webStore()?.setItem(key, value);
      else await SecureStore.setItemAsync(key, value);
    } catch {
      /* storage unavailable: value lives in memory only for this run */
    }
  },
  async remove(key: string): Promise<void> {
    try {
      if (Platform.OS === 'web') webStore()?.removeItem(key);
      else await SecureStore.deleteItemAsync(key);
    } catch {
      /* ignore */
    }
  },
};
