import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { createHash } from 'crypto';
import { AppError } from '../../common/errors';
import { PrismaService } from '../../common/prisma.service';
import { Actor, OrderLifecycleService } from './order-lifecycle.service';
import { PricingService } from './pricing.service';
import { UploadsService } from '../uploads/uploads.service';

export interface CreateOrderInput {
  customerId: string;
  idempotencyKey: string;
  addressId?: string;
  fulfillment: 'DELIVERY' | 'PICKUP';
  paymentMethod: 'CARD' | 'CASH_ON_DELIVERY';
  couponCode?: string;
  expectedTotal: number;
  note?: string;
}

const ORDER_INCLUDE = {
  items: true,
  history: { orderBy: { createdAt: 'asc' as const } },
  kitchen: { select: { id: true, name: true, nameAr: true, coverKey: true, prepTimeMin: true } },
  payments: {
    select: { id: true, method: true, status: true, amountMinor: true, provider: true },
    orderBy: { createdAt: 'desc' as const },
  },
  review: { select: { id: true, rating: true } },
} satisfies Prisma.OrderInclude;

@Injectable()
export class OrdersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly pricing: PricingService,
    private readonly lifecycle: OrderLifecycleService,
    private readonly uploads: UploadsService,
  ) {}

  present(o: Prisma.OrderGetPayload<{ include: typeof ORDER_INCLUDE }>) {
    return {
      id: o.id,
      orderNo: o.orderNo,
      status: o.status,
      fulfillment: o.fulfillment,
      paymentMethod: o.paymentMethod,
      currency: o.currency,
      subtotalMinor: o.subtotalMinor,
      discountMinor: o.discountMinor,
      deliveryFeeMinor: o.deliveryFeeMinor,
      serviceFeeMinor: o.serviceFeeMinor,
      taxMinor: o.taxMinor,
      totalMinor: o.totalMinor,
      couponCode: o.couponCode,
      note: o.note,
      etaMinutes: o.etaMinutes,
      address: o.addressSnapshot,
      cancelReason: o.cancelReason,
      placedAt: o.placedAt,
      deliveredAt: o.deliveredAt,
      createdAt: o.createdAt,
      kitchen: o.kitchen
        ? {
            id: o.kitchen.id,
            name: o.kitchen.name,
            nameAr: o.kitchen.nameAr,
            coverUrl: this.uploads.url(o.kitchen.coverKey),
          }
        : null,
      items: o.items.map((i) => ({
        id: i.id,
        menuItemId: i.menuItemId,
        name: i.name,
        quantity: i.quantity,
        unitPriceMinor: i.unitPriceMinor,
        lineTotalMinor: i.lineTotalMinor,
        note: i.note,
        options: i.options,
      })),
      history: o.history.map((h) => ({
        from: h.fromStatus,
        to: h.toStatus,
        actor: h.actorType,
        reason: h.reason,
        at: h.createdAt,
      })),
      payments: o.payments,
      reviewed: !!o.review,
    };
  }

  /**
   * Idempotent order creation. The same (customer, Idempotency-Key) always yields the same order;
   * reusing a key with a different body is rejected. Everything that must be atomic is one transaction:
   * re-pricing, stock reservation, coupon redemption, order + items + history, cart clear.
   */
  async create(input: CreateOrderInput) {
    const requestHash = createHash('sha256')
      .update(JSON.stringify({ ...input, idempotencyKey: undefined }))
      .digest('hex');
    const scope = `order:${input.customerId}`;

    try {
      await this.prisma.idempotencyKey.create({
        data: { scope, key: input.idempotencyKey, requestHash },
      });
    } catch (e) {
      if (!(e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002')) throw e;
      const prior = await this.prisma.idempotencyKey.findUniqueOrThrow({
        where: { scope_key: { scope, key: input.idempotencyKey } },
      });
      if (prior.requestHash !== requestHash)
        throw new AppError(
          'IDEMPOTENCY_CONFLICT',
          'This Idempotency-Key was already used with a different request.',
        );
      const existing = await this.prisma.order.findUnique({
        where: {
          customerId_idempotencyKey: {
            customerId: input.customerId,
            idempotencyKey: input.idempotencyKey,
          },
        },
        include: ORDER_INCLUDE,
      });
      if (existing) return { order: this.present(existing), replayed: true };
      throw new AppError('CONFLICT', 'This order is still being processed. Retry shortly.');
    }

    try {
      const order = await this.prisma.$transaction(async (tx) => {
        const cart = await tx.cart.findUnique({
          where: { customerId: input.customerId },
          include: { items: true },
        });
        if (!cart?.kitchenId || !cart.items.length)
          throw new AppError('CART_EMPTY', 'Your cart is empty.');

        const quote = await this.pricing.quote(
          cart.kitchenId,
          cart.items.map((i) => ({
            id: i.id,
            menuItemId: i.menuItemId,
            quantity: i.quantity,
            optionIds: i.optionIds,
            note: i.note,
          })),
          {
            fulfillment: input.fulfillment,
            addressId: input.addressId,
            couponCode: input.couponCode,
            customerId: input.customerId,
          },
          tx,
        );
        this.pricing.assertValid(quote);
        if (quote.pricing.total !== input.expectedTotal) {
          throw new AppError('PRICE_CHANGED', 'Prices changed since you last viewed your cart.', {
            expectedTotal: input.expectedTotal,
            actualTotal: quote.pricing.total,
          });
        }

        // Reserve limited stock atomically: the WHERE guard makes overselling impossible under concurrency.
        for (const l of quote.lines) {
          const item = await tx.menuItem.findUniqueOrThrow({
            where: { id: l.menuItemId },
            select: { stock: true },
          });
          if (item.stock != null) {
            const r = await tx.menuItem.updateMany({
              where: { id: l.menuItemId, stock: { gte: l.quantity } },
              data: { stock: { decrement: l.quantity } },
            });
            if (r.count !== 1)
              throw new AppError('ITEM_UNAVAILABLE', `${l.name} just sold out.`, {
                menuItemId: l.menuItemId,
              });
          }
        }

        const p = quote.pricing;
        const created = await tx.order.create({
          data: {
            customerId: input.customerId,
            kitchenId: quote.kitchenId,
            fulfillment: input.fulfillment,
            paymentMethod: input.paymentMethod,
            currency: quote.currency,
            subtotalMinor: p.subtotal,
            discountMinor: p.discount,
            deliveryFeeMinor: p.deliveryFee,
            serviceFeeMinor: p.serviceFee,
            taxMinor: p.tax,
            totalMinor: p.total,
            commissionBps: quote.commissionBps,
            couponId: quote.coupon?.id,
            couponCode: quote.coupon?.code,
            addressSnapshot: quote.address ?? undefined,
            note: input.note,
            etaMinutes: quote.etaMinutes,
            idempotencyKey: input.idempotencyKey,
            items: {
              create: quote.lines.map((l) => ({
                menuItemId: l.menuItemId,
                name: l.name,
                unitPriceMinor: l.unitPriceMinor,
                quantity: l.quantity,
                lineTotalMinor: l.lineTotalMinor,
                note: l.note,
                options: l.options as unknown as Prisma.InputJsonValue,
              })),
            },
            history: {
              create: {
                fromStatus: null,
                toStatus: 'PENDING_PAYMENT',
                actorType: 'CUSTOMER',
                actorId: input.customerId,
              },
            },
          },
        });
        if (quote.coupon) {
          // Guarded increment so the usage limit holds under concurrency.
          const c = await tx.coupon.findUniqueOrThrow({ where: { id: quote.coupon.id } });
          const r = await tx.coupon.updateMany({
            where: {
              id: c.id,
              ...(c.usageLimit != null ? { usedCount: { lt: c.usageLimit } } : {}),
            },
            data: { usedCount: { increment: 1 } },
          });
          if (r.count !== 1)
            throw new AppError('COUPON_INVALID', 'This coupon has been fully redeemed.');
          await tx.couponRedemption.create({
            data: { couponId: c.id, userId: input.customerId, orderId: created.id },
          });
        }
        await tx.cart.delete({ where: { id: cart.id } });
        return created;
      });
      const full = await this.prisma.order.findUniqueOrThrow({
        where: { id: order.id },
        include: ORDER_INCLUDE,
      });
      const response = this.present(full);
      await this.prisma.idempotencyKey.update({
        where: { scope_key: { scope, key: input.idempotencyKey } },
        data: { status: 201, response: response as unknown as Prisma.InputJsonValue },
      });
      return { order: response, replayed: false };
    } catch (e) {
      // Deterministic failures free the key so the customer can fix the cart and retry.
      await this.prisma.idempotencyKey
        .delete({ where: { scope_key: { scope, key: input.idempotencyKey } } })
        .catch(() => undefined);
      throw e;
    }
  }

  async getForCustomer(customerId: string, id: string) {
    const o = await this.prisma.order.findFirst({
      where: { id, customerId },
      include: ORDER_INCLUDE,
    });
    if (!o) throw new AppError('NOT_FOUND', 'Order not found.'); // 404 (not 403) so order ids can't be probed
    return this.present(o);
  }

  async listForCustomer(customerId: string, cursor?: string) {
    const take = 20;
    const rows = await this.prisma.order.findMany({
      where: { customerId },
      include: ORDER_INCLUDE,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: take + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    return {
      items: rows.slice(0, take).map((r) => this.present(r)),
      nextCursor: rows.length > take ? rows[take - 1].id : null,
    };
  }

  async customerTransition(
    customerId: string,
    id: string,
    to: 'CANCELLED' | 'COMPLETED',
    reason?: string,
  ) {
    const o = await this.prisma.order.findFirst({
      where: { id, customerId },
      select: { id: true },
    });
    if (!o) throw new AppError('NOT_FOUND', 'Order not found.');
    const actor: Actor = { type: 'CUSTOMER', id: customerId };
    await this.lifecycle.transition(id, to, actor, reason);
    return this.getForCustomer(customerId, id);
  }

  async getForKitchen(kitchenIds: string[], id: string) {
    const o = await this.prisma.order.findFirst({
      where: { id, kitchenId: { in: kitchenIds } },
      include: { ...ORDER_INCLUDE, customer: { select: { name: true, phone: true } } },
    });
    if (!o) throw new AppError('NOT_FOUND', 'Order not found.');
    // Cooks see the customer's first name and phone only while the order is active.
    const active = ['PLACED', 'ACCEPTED', 'PREPARING', 'READY', 'OUT_FOR_DELIVERY'].includes(
      o.status,
    );
    return {
      ...this.present(o),
      customer: { name: o.customer.name.split(' ')[0], phone: active ? o.customer.phone : null },
    };
  }
}
