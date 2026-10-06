/** All money is integer minor units (e.g. halalas/fils/cents). Never floats. */
export type Minor = number;

export interface PricingInput {
  subtotal: Minor;
  deliveryFee: Minor;
  /** Parts-per-ten-thousand (bps). 1500 = 15%. */
  taxBps: number;
  serviceFeeBps: number;
  discount: Minor;
}

export interface PricingResult {
  subtotal: Minor;
  discount: Minor;
  deliveryFee: Minor;
  serviceFee: Minor;
  tax: Minor;
  total: Minor;
}

export function bpsOf(amount: Minor, bps: number): Minor {
  return Math.round((amount * bps) / 10000);
}

/**
 * Tax is applied on (subtotal - discount + serviceFee + deliveryFee). Total never negative.
 */
export function computeTotals(i: PricingInput): PricingResult {
  assertMinor(i.subtotal, 'subtotal');
  assertMinor(i.deliveryFee, 'deliveryFee');
  assertMinor(i.discount, 'discount');
  const discount = Math.min(i.discount, i.subtotal);
  const net = i.subtotal - discount;
  const serviceFee = bpsOf(net, i.serviceFeeBps);
  const taxable = net + serviceFee + i.deliveryFee;
  const tax = bpsOf(taxable, i.taxBps);
  return {
    subtotal: i.subtotal,
    discount,
    deliveryFee: i.deliveryFee,
    serviceFee,
    tax,
    total: taxable + tax,
  };
}

export function assertMinor(n: number, label: string): void {
  if (!Number.isSafeInteger(n) || n < 0)
    throw new RangeError(`${label} must be a non-negative integer`);
}

export type DiscountType = 'PERCENT' | 'FIXED';

export function couponDiscount(
  subtotal: Minor,
  type: DiscountType,
  value: number,
  maxDiscount?: Minor | null,
): Minor {
  let d = type === 'PERCENT' ? bpsOf(subtotal, value * 100) : value;
  if (maxDiscount != null) d = Math.min(d, maxDiscount);
  return Math.max(0, Math.min(d, subtotal));
}

export interface Settlement {
  commission: Minor;
  /** Credited to the kitchen: subtotal - commission + delivery fee (kitchens deliver themselves for now). */
  vendorEarnings: Minor;
  /** Credited to the platform: commission + service fee - platform-funded discount. May be negative. */
  platformFee: Minor;
  tax: Minor;
}

/**
 * Splits a customer's order total across ledger accounts. Coupons are platform-funded, so the
 * kitchen's earnings never depend on the discount. Invariant: vendorEarnings + platformFee + tax === total.
 */
export function settlement(o: {
  subtotal: Minor;
  discount: Minor;
  deliveryFee: Minor;
  serviceFee: Minor;
  tax: Minor;
  commissionBps: number;
}): Settlement {
  const commission = bpsOf(o.subtotal, o.commissionBps);
  return {
    commission,
    vendorEarnings: o.subtotal - commission + o.deliveryFee,
    platformFee: commission + o.serviceFee - o.discount,
    tax: o.tax,
  };
}
