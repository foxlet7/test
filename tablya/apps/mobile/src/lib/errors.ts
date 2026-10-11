import { ApiError } from './api';
import { tr } from './i18n';
import type { Locale } from '@tablya/shared';

/** Turns any thrown value into a message that is safe and useful to show a customer. */
export function errorMessage(e: unknown, locale: Locale): string {
  if (e instanceof ApiError) {
    const key = `errors.${e.body.code}`;
    const translated = tr(locale, key);
    if (translated !== key) return translated;
    // Server messages are customer-safe English; fall back to them only for 4xx.
    if (e.status >= 400 && e.status < 500 && e.body.message) return e.body.message;
  }
  return tr(locale, 'common.error');
}
