import { Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { ActorType, Order, OrderStatus, Prisma } from '@prisma/client';
import { canTransition } from '@tablya/shared';
import { AppError } from '../../common/errors';
import { PrismaService } from '../../common/prisma.service';

export interface Actor {
  type: ActorType;
  id?: string | null;
}

export interface TransitionEvent {
  orderId: string;
  from: OrderStatus;
  to: OrderStatus;
  actor: Actor;
  reason?: string;
}
export const ORDER_TRANSITIONED = 'order.transitioned';

/**
 * The only code path that changes Order.status. Enforces the shared state machine,
 * claims the row with a compare-and-set on the previous status (so concurrent actors can't both win),
 * appends immutable history, and unwinds stock/coupons on cancel/reject — all in one transaction.
 */
@Injectable()
export class OrderLifecycleService {
  constructor(private readonly prisma: PrismaService, private readonly events: EventEmitter2) {}

  async transition(orderId: string, to: OrderStatus, actor: Actor, reason?: string): Promise<Order> {
    const run = async (tx: Prisma.TransactionClient) => {
      const order = await tx.order.findUnique({ where: { id: orderId } });
      if (!order) throw new AppError('NOT_FOUND', 'Order not found.');
      const from = order.status;
      if (!canTransition(from, to, actor.type)) {
        throw new AppError('ILLEGAL_TRANSITION', `Cannot move an order from ${from} to ${to}.`, { from, to });
      }
      const now = new Date();
      const claimed = await tx.order.updateMany({
        where: { id: orderId, status: from },
        data: {
          status: to,
          version: { increment: 1 },
          ...(to === 'PLACED' ? { placedAt: now } : {}),
          ...(to === 'DELIVERED' ? { deliveredAt: now } : {}),
          ...(to === 'CANCELLED' || to === 'REJECTED' ? { cancelReason: reason ?? null } : {}),
        },
      });
      if (claimed.count !== 1) throw new AppError('ILLEGAL_TRANSITION', 'This order was just updated by someone else. Refresh and try again.');
      await tx.orderStatusHistory.create({ data: { orderId, fromStatus: from, toStatus: to, actorType: actor.type, actorId: actor.id ?? null, reason } });

      if (to === 'CANCELLED' || to === 'REJECTED') await this.unwind(tx, order);
      if (to === 'COMPLETED') {
        const items = await tx.orderItem.findMany({ where: { orderId, menuItemId: { not: null } } });
        for (const i of items) await tx.menuItem.updateMany({ where: { id: i.menuItemId! }, data: { soldCount: { increment: i.quantity } } });
      }
      return { order: { ...order, status: to }, from };
    };

    const { order, from } = await this.prisma.$transaction(run);
    // Listeners (notifications, refunds, ledger) run after commit and must not fail the transition.
    await this.events.emitAsync(ORDER_TRANSITIONED, { orderId, from, to, actor, reason } satisfies TransitionEvent);
    return order;
  }

  /** Restore reserved stock and release coupon usage. */
  private async unwind(tx: Prisma.TransactionClient, order: Order) {
    const items = await tx.orderItem.findMany({ where: { orderId: order.id, menuItemId: { not: null } } });
    for (const i of items) {
      await tx.menuItem.updateMany({ where: { id: i.menuItemId!, stock: { not: null } }, data: { stock: { increment: i.quantity } } });
    }
    if (order.couponId) {
      const red = await tx.couponRedemption.deleteMany({ where: { orderId: order.id } });
      if (red.count) await tx.coupon.update({ where: { id: order.couponId }, data: { usedCount: { decrement: 1 } } });
    }
  }
}
