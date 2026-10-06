export const ORDER_STATUSES = [
  'PENDING_PAYMENT',
  'PLACED',
  'ACCEPTED',
  'PREPARING',
  'READY',
  'OUT_FOR_DELIVERY',
  'DELIVERED',
  'COMPLETED',
  'CANCELLED',
  'REJECTED',
  'REFUND_PENDING',
  'REFUNDED',
] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

export type Actor = 'CUSTOMER' | 'COOK' | 'ADMIN' | 'SYSTEM';

export interface Transition {
  to: OrderStatus;
  actors: Actor[];
}

/**
 * Single source of truth for legal order transitions.
 * PLACED means payment is confirmed (or cash-on-delivery chosen) and the kitchen has been notified.
 */
export const ORDER_TRANSITIONS: Record<OrderStatus, Transition[]> = {
  PENDING_PAYMENT: [
    { to: 'PLACED', actors: ['SYSTEM'] },
    { to: 'CANCELLED', actors: ['CUSTOMER', 'ADMIN', 'SYSTEM'] },
  ],
  PLACED: [
    { to: 'ACCEPTED', actors: ['COOK', 'ADMIN'] },
    { to: 'REJECTED', actors: ['COOK', 'ADMIN', 'SYSTEM'] },
    { to: 'CANCELLED', actors: ['CUSTOMER', 'ADMIN'] },
  ],
  ACCEPTED: [
    { to: 'PREPARING', actors: ['COOK', 'ADMIN'] },
    { to: 'CANCELLED', actors: ['COOK', 'ADMIN'] },
  ],
  PREPARING: [
    { to: 'READY', actors: ['COOK', 'ADMIN'] },
    { to: 'CANCELLED', actors: ['COOK', 'ADMIN'] },
  ],
  READY: [
    { to: 'OUT_FOR_DELIVERY', actors: ['COOK', 'ADMIN'] },
    { to: 'DELIVERED', actors: ['COOK', 'ADMIN'] },
    { to: 'CANCELLED', actors: ['ADMIN'] },
  ],
  OUT_FOR_DELIVERY: [
    { to: 'DELIVERED', actors: ['COOK', 'ADMIN'] },
    { to: 'CANCELLED', actors: ['ADMIN'] },
  ],
  DELIVERED: [
    { to: 'COMPLETED', actors: ['CUSTOMER', 'SYSTEM', 'ADMIN'] },
    { to: 'REFUND_PENDING', actors: ['ADMIN'] },
  ],
  COMPLETED: [{ to: 'REFUND_PENDING', actors: ['ADMIN'] }],
  CANCELLED: [{ to: 'REFUND_PENDING', actors: ['SYSTEM', 'ADMIN'] }],
  REJECTED: [{ to: 'REFUND_PENDING', actors: ['SYSTEM', 'ADMIN'] }],
  REFUND_PENDING: [{ to: 'REFUNDED', actors: ['SYSTEM', 'ADMIN'] }],
  REFUNDED: [],
};

export function canTransition(from: OrderStatus, to: OrderStatus, actor: Actor): boolean {
  return ORDER_TRANSITIONS[from].some((t) => t.to === to && t.actors.includes(actor));
}

export function allowedNext(from: OrderStatus, actor: Actor): OrderStatus[] {
  return ORDER_TRANSITIONS[from].filter((t) => t.actors.includes(actor)).map((t) => t.to);
}

export const TERMINAL_STATUSES: OrderStatus[] = ['REFUNDED'];
/** Statuses in which the kitchen still has work to do. */
export const ACTIVE_KITCHEN_STATUSES: OrderStatus[] = [
  'PLACED',
  'ACCEPTED',
  'PREPARING',
  'READY',
  'OUT_FOR_DELIVERY',
];
/** Statuses after which money is owed back to the customer if it was captured. */
export const REFUNDABLE_ENTRY_STATUSES: OrderStatus[] = ['CANCELLED', 'REJECTED'];
