import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { computeTotals, couponDiscount, haversineKm, PricingResult, ErrorCode } from '@tablya/shared';
import { AppError } from '../../common/errors';
import { PrismaService } from '../../common/prisma.service';
import { SettingsService } from '../../common/settings.service';
import { KitchenPresenter, KITCHEN_INCLUDE, KitchenFull } from '../catalog/kitchen.presenter';

export interface CartLineInput {
  id?: string;
  menuItemId: string;
  quantity: number;
  optionIds: string[];
  note?: string | null;
}

export interface QuoteIssue {
  code: ErrorCode;
  message: string;
  menuItemId?: string;
}

export interface QuoteLine {
  cartItemId?: string;
  menuItemId: string;
  name: string;
  nameAr: string | null;
  imageKey: string | null;
  quantity: number;
  unitPriceMinor: number;
  lineTotalMinor: number;
  note: string | null;
  options: { id: string; name: string; nameAr: string | null; priceDeltaMinor: number }[];
}

export interface Quote {
  kitchenId: string;
  currency: string;
  lines: QuoteLine[];
  pricing: PricingResult;
  etaMinutes: number | null;
  coupon: { id: string; code: string } | null;
  commissionBps: number;
  issues: QuoteIssue[];
  address: Prisma.JsonObject | null;
}

export interface QuoteOptions {
  fulfillment: 'DELIVERY' | 'PICKUP';
  addressId?: string;
  couponCode?: string;
  customerId: string;
}

const EMPTY_PRICING: PricingResult = { subtotal: 0, discount: 0, deliveryFee: 0, serviceFee: 0, tax: 0, total: 0 };

/**
 * The only place prices are computed. Client-supplied amounts are never used.
 * Collects `issues` instead of throwing so the cart screen can show everything that's wrong;
 * checkout throws the first issue via `assertValid`.
 */
@Injectable()
export class PricingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly presenter: KitchenPresenter,
    private readonly settings: SettingsService,
  ) {}

  assertValid(q: Quote) {
    if (q.issues.length) {
      const i = q.issues[0];
      throw new AppError(i.code, i.message, { issues: q.issues });
    }
  }

  async quote(kitchenId: string, lines: CartLineInput[], opt: QuoteOptions, db: Prisma.TransactionClient | PrismaService = this.prisma): Promise<Quote> {
    const settings = await this.settings.get();
    const issues: QuoteIssue[] = [];
    const empty = (): Quote => ({ kitchenId, currency: settings.currency, lines: [], pricing: EMPTY_PRICING, etaMinutes: null, coupon: null, commissionBps: settings.defaultCommissionBps, issues, address: null });
    if (!lines.length) {
      issues.push({ code: 'CART_EMPTY', message: 'Your cart is empty.' });
      return empty();
    }

    const kitchen = (await db.kitchen.findFirst({ where: { id: kitchenId, verification: 'VERIFIED', deletedAt: null, owner: { status: 'ACTIVE' } }, include: KITCHEN_INCLUDE })) as KitchenFull | null;
    if (!kitchen) {
      issues.push({ code: 'KITCHEN_UNAVAILABLE', message: 'This kitchen is no longer accepting orders.' });
      return empty();
    }
    if (await db.userBlock.findUnique({ where: { blockerId_blockedId: { blockerId: kitchen.ownerId, blockedId: opt.customerId } } })) {
      issues.push({ code: 'KITCHEN_UNAVAILABLE', message: 'This kitchen is no longer accepting orders.' });
    }
    const counts = await this.presenter.activeCounts([kitchen.id]);
    const availability = this.presenter.availabilityOf(kitchen, counts.get(kitchen.id) ?? 0);
    if (availability !== 'OPEN') issues.push({ code: 'KITCHEN_UNAVAILABLE', message: 'This kitchen is no longer accepting orders.' });

    const items = await db.menuItem.findMany({
      where: { id: { in: [...new Set(lines.map((l) => l.menuItemId))] }, kitchenId: kitchen.id, deletedAt: null },
      include: { optionGroups: { include: { options: true } } },
    });
    const byId = new Map(items.map((i) => [i.id, i]));
    const demand = new Map<string, number>();

    const out: QuoteLine[] = [];
    for (const l of lines) {
      const item = byId.get(l.menuItemId);
      if (!item) {
        issues.push({ code: 'ITEM_UNAVAILABLE', message: 'An item in your cart is no longer available.', menuItemId: l.menuItemId });
        continue;
      }
      demand.set(item.id, (demand.get(item.id) ?? 0) + l.quantity);
      if (!item.isAvailable || (item.stock != null && item.stock < (demand.get(item.id) ?? 0))) {
        issues.push({ code: 'ITEM_UNAVAILABLE', message: `${item.name} is no longer available in this quantity.`, menuItemId: item.id });
      }

      // Option validation: every id must belong to this item, be available, and satisfy group rules.
      const chosen = [];
      const optionIds = [...new Set(l.optionIds)];
      const allOptions = new Map(item.optionGroups.flatMap((g) => g.options.map((o) => [o.id, { o, g }] as const)));
      let optionsOk = true;
      for (const oid of optionIds) {
        const hit = allOptions.get(oid);
        if (!hit || !hit.o.isAvailable) {
          issues.push({ code: 'ITEM_UNAVAILABLE', message: `A selected option for ${item.name} is unavailable.`, menuItemId: item.id });
          optionsOk = false;
          continue;
        }
        chosen.push(hit.o);
      }
      for (const g of item.optionGroups) {
        const n = g.options.filter((o) => optionIds.includes(o.id)).length;
        if ((g.required && n < Math.max(1, g.minSelect)) || n < g.minSelect || n > g.maxSelect) {
          issues.push({ code: 'VALIDATION_FAILED', message: `Please choose a valid selection for "${g.name}" on ${item.name}.`, menuItemId: item.id });
          optionsOk = false;
        }
      }
      if (!optionsOk) continue;

      const unit = item.priceMinor + chosen.reduce((s, o) => s + o.priceDeltaMinor, 0);
      out.push({
        cartItemId: l.id, menuItemId: item.id, name: item.name, nameAr: item.nameAr, imageKey: item.imageKeys[0] ?? null,
        quantity: l.quantity, unitPriceMinor: Math.max(0, unit), lineTotalMinor: Math.max(0, unit) * l.quantity,
        note: l.note ?? null, options: chosen.map((o) => ({ id: o.id, name: o.name, nameAr: o.nameAr, priceDeltaMinor: o.priceDeltaMinor })),
      });
    }
    const subtotal = out.reduce((s, l) => s + l.lineTotalMinor, 0);

    if (subtotal < kitchen.minOrderMinor && out.length) {
      issues.push({ code: 'MIN_ORDER_NOT_MET', message: 'The minimum order amount has not been reached.' });
    }

    // Delivery
    let deliveryFee = 0;
    let etaMinutes: number | null = kitchen.prepTimeMin;
    let addressSnapshot: Prisma.JsonObject | null = null;
    if (opt.fulfillment === 'PICKUP') {
      if (!kitchen.pickupEnabled) issues.push({ code: 'KITCHEN_UNAVAILABLE', message: 'This kitchen does not offer pickup.' });
    } else {
      if (!kitchen.deliveryEnabled) issues.push({ code: 'OUT_OF_DELIVERY_ZONE', message: 'This kitchen does not offer delivery.' });
      else if (!opt.addressId) issues.push({ code: 'VALIDATION_FAILED', message: 'Choose a delivery address.' });
      else {
        const addr = await db.address.findFirst({ where: { id: opt.addressId, userId: opt.customerId, deletedAt: null } });
        if (!addr) issues.push({ code: 'NOT_FOUND', message: 'Address not found.' });
        else {
          const dist = haversineKm(addr, kitchen);
          const zone = [...kitchen.zones].sort((a, b) => a.maxKm - b.maxKm).find((z) => dist <= z.maxKm);
          if (!zone) issues.push({ code: 'OUT_OF_DELIVERY_ZONE', message: 'This kitchen does not deliver to your address.' });
          else {
            deliveryFee = zone.feeMinor;
            etaMinutes = kitchen.prepTimeMin + zone.etaMinutes;
          }
          addressSnapshot = { id: addr.id, label: addr.label, line1: addr.line1, line2: addr.line2, city: addr.city, lat: addr.lat, lng: addr.lng, notes: addr.notes };
        }
      }
    }

    // Coupon
    let discount = 0;
    let coupon: Quote['coupon'] = null;
    if (opt.couponCode) {
      const c = await db.coupon.findUnique({ where: { code: opt.couponCode.toUpperCase() } });
      const now = new Date();
      const fail = (m: string) => issues.push({ code: 'COUPON_INVALID', message: m });
      if (!c || !c.active || (c.startsAt && c.startsAt > now) || (c.endsAt && c.endsAt < now)) fail('This coupon is not valid.');
      else if (c.kitchenId && c.kitchenId !== kitchen.id) fail('This coupon does not apply to this kitchen.');
      else if (subtotal < c.minSubtotalMinor) fail('Your order does not meet the coupon minimum.');
      else if (c.usageLimit != null && c.usedCount >= c.usageLimit) fail('This coupon has been fully redeemed.');
      else if ((await db.couponRedemption.count({ where: { couponId: c.id, userId: opt.customerId } })) >= c.perUserLimit) fail('You have already used this coupon.');
      else {
        discount = couponDiscount(subtotal, c.type, c.value, c.maxDiscountMinor);
        coupon = { id: c.id, code: c.code };
      }
    }

    const pricing = computeTotals({ subtotal, deliveryFee, taxBps: settings.taxBps, serviceFeeBps: settings.serviceFeeBps, discount });
    return {
      kitchenId: kitchen.id, currency: settings.currency, lines: out, pricing, etaMinutes, coupon,
      commissionBps: kitchen.commissionBps ?? settings.defaultCommissionBps, issues, address: addressSnapshot,
    };
  }
}
