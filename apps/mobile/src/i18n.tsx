import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';
import { I18nManager } from 'react-native';
import { getLocales } from 'expo-localization';
import { en, isRtl, translate, type I18nKey, type Language } from '@gdc/shared';

interface Ctx { lang: Language; setLang: (l: Language) => void; t: (k: I18nKey, v?: Record<string, string | number>) => string; /** translate a key built from server data; falls back to the raw value */ td: (k: string) => string; rtl: boolean }
const LangContext = createContext<Ctx>(null as unknown as Ctx);

function deviceLanguage(): Language {
  try { return getLocales()[0]?.languageCode === 'ar' ? 'ar' : 'en'; } catch { return 'en'; }
}

export function LangProvider({ children }: { children: ReactNode }) {
  const [lang, setLang] = useState<Language>(deviceLanguage());
  // Layout direction follows the interface language via the `direction` style, so no app restart is needed.
  I18nManager.allowRTL(true);
  const value = useMemo<Ctx>(() => ({ lang, setLang, rtl: isRtl(lang), t: (k, v) => translate(lang, k, v), td: (k) => (k in en ? translate(lang, k as I18nKey) : k) }), [lang]);
  return <LangContext.Provider value={value}>{children}</LangContext.Provider>;
}
export const useLang = () => useContext(LangContext);

/** Pick the English or Arabic variant of a content field. Interface language never changes which religious content is shown. */
export const pick = (lang: Language, en: string | null | undefined, ar: string | null | undefined) => (lang === 'ar' ? ar || en : en || ar) ?? '';

export const errorKey = (code: string): I18nKey => {
  switch (code) {
    case 'invalid_credentials': return 'auth.invalid';
    case 'invite_invalid': return 'auth.inviteInvalid';
    case 'daily_limit': return 'log.daily_limit';
    case 'weekly_limit': return 'log.weekly_limit';
    case 'milestone_done': return 'log.milestone_done';
    case 'milestone_key_required': return 'log.milestone_key_required';
    case 'future': return 'log.future';
    case 'too_old': return 'log.too_old';
    default: return 'common.error';
  }
};
