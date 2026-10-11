import { I18nManager, Platform } from 'react-native';
import { getLocales } from 'expo-localization';
import { create } from 'zustand';
import { formatMoney, messages as shared, type Locale } from '@tablya/shared';
import { local } from './strings';
import { storage } from './storage';

interface I18nState {
  locale: Locale;
  ready: boolean;
  init(): Promise<void>;
  setLocale(l: Locale): Promise<{ needsRestart: boolean }>;
}

const KEY = 'tablya.locale';

export const useI18n = create<I18nState>((set) => ({
  locale: 'en',
  ready: false,
  async init() {
    const saved = await storage.get(KEY);
    const device = getLocales()[0]?.languageCode;
    const locale: Locale = saved === 'ar' || saved === 'en' ? saved : device === 'ar' ? 'ar' : 'en';
    applyDirection(locale);
    set({ locale, ready: true });
  },
  async setLocale(l) {
    await storage.set(KEY, l);
    const needsRestart = applyDirection(l);
    set({ locale: l });
    return { needsRestart };
  },
}));

/** Returns true when a native restart is needed for the layout direction to flip. */
function applyDirection(l: Locale): boolean {
  const rtl = l === 'ar';
  if (Platform.OS === 'web') {
    if (typeof document !== 'undefined') {
      document.documentElement.dir = rtl ? 'rtl' : 'ltr';
      document.documentElement.lang = l;
    }
    return false;
  }
  I18nManager.allowRTL(true);
  if (I18nManager.isRTL !== rtl) {
    I18nManager.forceRTL(rtl);
    return true;
  }
  return false;
}

export function tr(locale: Locale, key: string, vars?: Record<string, string | number>): string {
  const raw = local[locale][key] ?? shared[locale][key] ?? local.en[key] ?? shared.en[key] ?? key;
  return vars ? raw.replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? '')) : raw;
}

export function useT() {
  const locale = useI18n((s) => s.locale);
  return {
    locale,
    isRtl: locale === 'ar',
    t: (key: string, vars?: Record<string, string | number>) => tr(locale, key, vars),
    money: (minor: number, currency = 'SAR') => formatMoney(minor, currency, locale),
    /** Pick the Arabic field when the UI is Arabic and one exists. */
    pick: (en: string | null | undefined, ar: string | null | undefined) =>
      locale === 'ar' && ar ? ar : (en ?? ar ?? ''),
  };
}
