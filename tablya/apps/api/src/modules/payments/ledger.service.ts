import { Injectable } from '@nestjs/common';
import { LedgerAccount, Order, Prisma } from '@prisma/client';
import { settlement } from '@tablya/shared';
import { PrismaService } from '../../common/prisma.service';

type Db = Prisma.TransactionClient | PrismaService;

/** Append-only financial ledger. All writes are idempotent via the unique (ref, account) constraint. */
@Injectable()
export class LedgerService {
  constructor(private readonly prisma: PrismaService) {}

  async post(
    db: Db,
    e: {
      orderId?: string | null;
      kitchenId?: string | null;
      account: LedgerAccount;
      amountMinor: number;
      currency: string;
      ref: string;
      memo?: string;
    },
  ) {
    if (e.amountMinor === 0) return;
    await (db as PrismaService).ledgerEntry.createMany({
      data: [{ ...e, orderId: e.orderId ?? null, kitchenId: e.kitchenId ?? null }],
      skipDuplicates: true,
    });
  }

  async capture(db: Db, order: Order, paymentId: string) {
    await this.post(db, {
      orderId: order.id,
      account: 'CUSTOMER_PAYMENT',
      amountMinor: order.totalMinor,
      currency: order.currency,
      ref: `payment:${paymentId}:capture`,
    });
  }

  /** Book the order's revenue split once it is COMPLETED. */
  async settle(db: Db, order: Order) {
    const s = settlement({
      subtotal: order.subtotalMinor,
      discount: order.discountMinor,
      deliveryFee: order.deliveryFeeMinor,
      serviceFee: order.serviceFeeMinor,
      tax: order.taxMinor,
      commissionBps: order.commissionBps,
    });
    const base = { orderId: order.id, currency: order.currency, ref: `order:${order.id}:settle` };
    await this.post(db, {
      ...base,
      kitchenId: order.kitchenId,
      account: 'VENDOR_EARNINGS',
      amountMinor: s.vendorEarnings,
    });
    await this.post(db, { ...base, account: 'PLATFORM_FEE', amountMinor: s.platformFee });
    await this.post(db, { ...base, account: 'TAX', amountMinor: s.tax });
    if (order.paymentMethod === 'CASH_ON_DELIVERY') {
      // The kitchen already holds the customer's cash; reduce what the platform owes them accordingly.
      await this.post(db, {
        orderId: order.id,
        kitchenId: order.kitchenId,
        account: 'VENDOR_EARNINGS',
        amountMinor: -order.totalMinor,
        currency: order.currency,
        ref: `order:${order.id}:cod-cash`,
      });
    }
  }

  /**
   * Record money returned to the customer and keep revenue accounts consistent.
   * - Partial refund: booked as an adjustment against the kitchen (or the platform when platform-funded).
   * - The refund that completes a full refund: reverses the whole settlement and any earlier partial adjustments,
   *   so every revenue account nets to zero for the order.
   */
  async refund(
    db: Db,
    order: Order,
    refundId: string,
    amountMinor: number,
    opts: { completesFull: boolean; platformFunded: boolean },
  ) {
    const common = { orderId: order.id, currency: order.currency };
    await this.post(db, {
      ...common,
      account: 'REFUND',
      amountMinor: -amountMinor,
      ref: `refund:${refundId}`,
    });
    const settled = await (db as PrismaService).ledgerEntry.findMany({
      where: { ref: `order:${order.id}:settle` },
    });
    if (!settled.length) return; // never recognised (cancelled before completion): nothing to reverse
    if (opts.completesFull) {
      for (const e of settled)
        await this.post(db, {
          ...common,
          kitchenId: e.kitchenId,
          account: e.account,
          amountMinor: -e.amountMinor,
          ref: `refund:${refundId}:rev`,
        });
      const prior = await (db as PrismaService).ledgerEntry.findMany({
        where: { orderId: order.id, ref: { startsWith: 'refund:', endsWith: ':adj' } },
      });
      for (const e of prior)
        await this.post(db, {
          ...common,
          kitchenId: e.kitchenId,
          account: e.account,
          amountMinor: -e.amountMinor,
          ref: `${e.ref}:undo:${refundId}`,
        });
    } else if (opts.platformFunded) {
      await this.post(db, {
        ...common,
        account: 'PLATFORM_FEE',
        amountMinor: -amountMinor,
        ref: `refund:${refundId}:adj`,
      });
    } else {
      await this.post(db, {
        ...common,
        kitchenId: order.kitchenId,
        account: 'ADJUSTMENT',
        amountMinor: -amountMinor,
        ref: `refund:${refundId}:adj`,
      });
    }
  }

  async kitchenBalance(kitchenId: string) {
    const [earn, paid] = await Promise.all([
      this.prisma.ledgerEntry.aggregate({
        where: { kitchenId, account: { in: ['VENDOR_EARNINGS', 'ADJUSTMENT'] } },
        _sum: { amountMinor: true },
      }),
      this.prisma.payout.aggregate({
        where: { kitchenId, status: { in: ['PENDING', 'PROCESSING', 'PAID'] } },
        _sum: { amountMinor: true },
      }),
    ]);
    const earned = earn._sum.amountMinor ?? 0;
    const paidOut = paid._sum.amountMinor ?? 0;
    return { earnedMinor: earned, paidOutMinor: paidOut, availableMinor: earned - paidOut };
  }
}
