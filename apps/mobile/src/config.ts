import Constants from 'expo-constants';

export const API_URL: string = (Constants.expoConfig?.extra as { apiUrl?: string } | undefined)?.apiUrl ?? 'http://localhost:8080';

// Production builds must talk to the API over TLS. Cleartext is allowed only in development builds.
if (!__DEV__ && !API_URL.startsWith('https://')) throw new Error('API_URL must be https:// in production builds');
