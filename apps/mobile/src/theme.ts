import { useColorScheme } from 'react-native';

const light = { bg: '#faf8f4', card: '#ffffff', fg: '#1d2a26', muted: '#5b6b66', line: '#e2ddd2', accent: '#1f6f5c', accentFg: '#ffffff', warn: '#b4531a', ok: '#2a7d46' };
const dark = { bg: '#12191a', card: '#1a2425', fg: '#e8efec', muted: '#9db0aa', line: '#2b3a3b', accent: '#52b79d', accentFg: '#0d1716', warn: '#e08a52', ok: '#5fc283' };
export type Theme = typeof light;
export const useTheme = (): Theme => (useColorScheme() === 'dark' ? dark : light);
