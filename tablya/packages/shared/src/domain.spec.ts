import {
  ORDER_STATUSES,
  ORDER_TRANSITIONS,
  allowedNext,
  canTransition,
  computeTotals,
  couponDiscount,
  haversineKm,
  isWithinSchedule,
  kitchenAvailability,
  messages,
  normalizeSearch,
  settlement,
  checkoutSchema,
  registerSchema,
} from './index';

describe('order state machine', () => {
  it('has transitions defined for every status', () => {
    for (const s of ORDER_STATUSES) expect(ORDER_TRANSITIONS[s]).toBeDefined();
  });
  it('allows the happy path with the right actors', () => {
    expect(canTransition('PENDING_PAYMENT', 'PLACED', 'SYSTEM')).toBe(true);
    expect(canTransition('PLACED', 'ACCEPTED', 'COOK')).toBe(true);
    expect(canTransition('ACCEPTED', 'PREPARING', 'COOK')).toBe(true);
    expect(canTransition('PREPARING', 'READY', 'COOK')).toBe(true);
    expect(canTransition('READY', 'OUT_FOR_DELIVERY', 'COOK')).toBe(true);
    expect(canTransition('OUT_FOR_DELIVERY', 'DELIVERED', 'COOK')).toBe(true);
    expect(canTransition('DELIVERED', 'COMPLETED', 'CUSTOMER')).toBe(true);
  });
  it('blocks illegal jumps and wrong actors', () => {
    expect(canTransition('PLACED', 'DELIVERED', 'COOK')).toBe(false);
    expect(canTransition('PLACED', 'ACCEPTED', 'CUSTOMER')).toBe(false);
    expect(canTransition('PENDING_PAYMENT', 'PLACED', 'CUSTOMER')).toBe(false);
    expect(canTransition('COMPLETED', 'PLACED', 'ADMIN')).toBe(false);
    expect(canTransition('REFUNDED', 'COMPLETED', 'ADMIN')).toBe(false);
  });
  it('customer cannot cancel once accepted', () => {
    expect(allowedNext('ACCEPTED', 'CUSTOMER')).toEqual([]);
    expect(allowedNext('PLACED', 'CUSTOMER')).toEqual(['CANCELLED']);
  });
  it('has no unreachable non-initial states', () => {
    const reachable = new Set<string>(['PENDING_PAYMENT']);
    let grew = true;
    while (grew) {
      grew = false;
      for (const s of [...reachable])
        for (const t of ORDER_TRANSITIONS[s as keyof typeof ORDER_TRANSITIONS])
          if (!reachable.has(t.to)) {
            reachable.add(t.to);
            grew = true;
          }
    }
    expect([...reachable].sort()).toEqual([...ORDER_STATUSES].sort());
  });
});

describe('pricing', () => {
  it('computes totals with integer math', () => {
    const r = computeTotals({
      subtotal: 10000,
      deliveryFee: 1000,
      taxBps: 1500,
      serviceFeeBps: 500,
      discount: 1000,
    });
    expect(r.serviceFee).toBe(450);
    expect(r.tax).toBe(Math.round(((9000 + 450 + 1000) * 1500) / 10000));
    expect(r.total).toBe(9000 + 450 + 1000 + r.tax);
    expect(Number.isInteger(r.total)).toBe(true);
  });
  it('never discounts below zero', () => {
    const r = computeTotals({
      subtotal: 500,
      deliveryFee: 0,
      taxBps: 0,
      serviceFeeBps: 0,
      discount: 9999,
    });
    expect(r.total).toBe(0);
  });
  it('rejects fractional/negative input', () => {
    expect(() =>
      computeTotals({ subtotal: 10.5, deliveryFee: 0, taxBps: 0, serviceFeeBps: 0, discount: 0 }),
    ).toThrow();
    expect(() =>
      computeTotals({ subtotal: -1, deliveryFee: 0, taxBps: 0, serviceFeeBps: 0, discount: 0 }),
    ).toThrow();
  });
  it('applies coupons with caps', () => {
    expect(couponDiscount(10000, 'PERCENT', 20)).toBe(2000);
    expect(couponDiscount(10000, 'PERCENT', 20, 1500)).toBe(1500);
    expect(couponDiscount(1000, 'FIXED', 5000)).toBe(1000);
  });
  it('settlement always reconciles to the customer total', () => {
    for (const [subtotal, discount, deliveryFee, taxBps, serviceFeeBps, commissionBps] of [
      [10000, 0, 1000, 1500, 0, 1500],
      [12345, 2000, 700, 1500, 300, 1200],
      [999, 999, 0, 500, 100, 2000],
      [50000, 100, 3333, 0, 0, 0],
    ]) {
      const p = computeTotals({ subtotal, discount, deliveryFee, taxBps, serviceFeeBps });
      const s = settlement({ ...p, commissionBps });
      expect(s.vendorEarnings + s.platformFee + s.tax).toBe(p.total);
    }
  });
});

describe('schedule', () => {
  const tz = 'Asia/Riyadh'; // UTC+3, no DST
  // 2026-10-06 is a Tuesday (dow 2)
  const at = (h: number, m = 0) => new Date(Date.UTC(2026, 9, 6, h - 3, m));
  it('open within a normal slot', () => {
    const slots = [{ dayOfWeek: 2, openMinute: 9 * 60, closeMinute: 17 * 60 }];
    expect(isWithinSchedule(slots, at(12), tz)).toBe(true);
    expect(isWithinSchedule(slots, at(17), tz)).toBe(false);
    expect(isWithinSchedule(slots, at(8, 59), tz)).toBe(false);
  });
  it('handles slots crossing midnight', () => {
    const slots = [{ dayOfWeek: 1, openMinute: 20 * 60, closeMinute: 2 * 60 }]; // Mon 20:00 -> Tue 02:00
    expect(isWithinSchedule(slots, at(1), tz)).toBe(true);
    expect(isWithinSchedule(slots, at(3), tz)).toBe(false);
  });
  it('derives availability states', () => {
    const base = {
      slots: [{ dayOfWeek: 2, openMinute: 0, closeMinute: 1439 }],
      timezone: tz,
      acceptingOrders: true,
      activeOrderCount: 0,
      now: at(12),
    };
    expect(kitchenAvailability(base)).toBe('OPEN');
    expect(kitchenAvailability({ ...base, acceptingOrders: false })).toBe(
      'TEMPORARILY_UNAVAILABLE',
    );
    expect(kitchenAvailability({ ...base, pausedUntil: new Date(at(12).getTime() + 1000) })).toBe(
      'TEMPORARILY_UNAVAILABLE',
    );
    expect(kitchenAvailability({ ...base, maxConcurrentOrders: 3, activeOrderCount: 3 })).toBe(
      'FULLY_BOOKED',
    );
    expect(kitchenAvailability({ ...base, slots: [] })).toBe('CLOSED');
  });
});

describe('search normalisation', () => {
  it('unifies Arabic variants', () => {
    expect(normalizeSearch('أَحْمَد')).toBe(normalizeSearch('احمد'));
    expect(normalizeSearch('مطبخ فاطمة')).toBe(normalizeSearch('مطبخ فاطمه'));
    expect(normalizeSearch('Pizza ١٢')).toBe('pizza 12');
  });
});

describe('geo + i18n + validation', () => {
  it('computes distance', () => {
    const d = haversineKm({ lat: 24.7136, lng: 46.6753 }, { lat: 21.4858, lng: 39.1925 });
    expect(d).toBeGreaterThan(830);
    expect(d).toBeLessThan(870);
  });
  it('en and ar share the same keys', () => {
    expect(Object.keys(messages.ar).sort()).toEqual(Object.keys(messages.en).sort());
  });
  it('validates registration and checkout', () => {
    expect(
      registerSchema.safeParse({ email: 'A@B.com', password: 'short', name: 'x' }).success,
    ).toBe(false);
    const ok = registerSchema.parse({ email: 'A@B.com', password: 'longenough1', name: 'x' });
    expect(ok.email).toBe('a@b.com');
    expect(ok.role).toBe('CUSTOMER');
    expect(
      registerSchema.safeParse({
        email: 'a@b.com',
        password: 'longenough1',
        name: 'x',
        role: 'ADMIN',
      }).success,
    ).toBe(false);
    expect(
      checkoutSchema.safeParse({
        fulfillment: 'DELIVERY',
        paymentMethod: 'CARD',
        expectedTotal: 1.5,
      }).success,
    ).toBe(false);
  });
});
