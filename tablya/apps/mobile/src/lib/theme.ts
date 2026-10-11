import { useColorScheme } from 'react-native';

export const palette = {
  light: {
    bg: '#F6F4EF',
    surface: '#FFFFFF',
    surface2: '#FAF8F3',
    text: '#1F1B16',
    muted: '#6A6258',
    border: '#E3DDD2',
    brand: '#B8420F',
    onBrand: '#FFFFFF',
    brandSoft: '#FBE9DF',
    ok: '#1D7A46',
    warn: '#A15C00',
    danger: '#B3261E',
  },
  dark: {
    bg: '#14110E',
    surface: '#1D1914',
    surface2: '#231E18',
    text: '#F2ECE3',
    muted: '#A79F93',
    border: '#38312A',
    brand: '#FF8A50',
    onBrand: '#1A0F08',
    brandSoft: '#3A2518',
    ok: '#5AD08A',
    warn: '#F0B04D',
    danger: '#FF8077',
  },
};
export type Colors = typeof palette.light;

export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 };
export const radius = { sm: 8, md: 12, lg: 20, pill: 999 };
export const type = {
  h1: { fontSize: 26, fontWeight: '800' as const },
  h2: { fontSize: 20, fontWeight: '700' as const },
  h3: { fontSize: 17, fontWeight: '700' as const },
  body: { fontSize: 15, fontWeight: '400' as const },
  small: { fontSize: 13, fontWeight: '400' as const },
  label: { fontSize: 13, fontWeight: '600' as const },
};
/** Minimum touch target per platform accessibility guidance. */
export const TOUCH = 44;

export function useColors(): Colors {
  return useColorScheme() === 'dark' ? palette.dark : palette.light;
}
