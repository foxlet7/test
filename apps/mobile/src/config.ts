import Constants from 'expo-constants';

declare const process: { env: Record<string, string | undefined> };
// EXPO_PUBLIC_API_URL (set at build time) wins over app.json extra.apiUrl.
export const API_URL: string = process.env.EXPO_PUBLIC_API_URL || (Constants.expoConfig?.extra as { apiUrl?: string } | undefined)?.apiUrl || 'http://localhost:8080';

/** Demo mode: the whole backend is simulated on the phone (no server). For testing the UI only. */
export const DEMO: boolean = process.env.EXPO_PUBLIC_DEMO === '1';

// Production builds must talk to the API over TLS. Cleartext is allowed only in development builds.
if (!DEMO && !__DEV__ && !API_URL.startsWith('https://')) throw new Error('API_URL must be https:// in production builds');
