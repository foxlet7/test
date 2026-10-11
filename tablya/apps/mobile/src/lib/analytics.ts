import { api } from './api';

type EventName =
  | 'app_opened'
  | 'search'
  | 'kitchen_viewed'
  | 'food_viewed'
  | 'add_to_cart'
  | 'checkout_started'
  | 'payment_started'
  | 'order_created'
  | 'order_completed'
  | 'review_created'
  | 'favorite_added';

/** Fire-and-forget, no personal data. Server whitelists names and ignores failures. */
export function track(name: EventName, props?: Record<string, string | number | boolean>) {
  void api('/analytics/events', { method: 'POST', body: { name, props } }).catch(() => undefined);
}
