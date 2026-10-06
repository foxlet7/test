import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { OrderStatus } from '@prisma/client';
import { AnalyticsService } from '../../common/analytics.service';
import { PrismaService } from '../../common/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { ORDER_TRANSITIONED, TransitionEvent } from '../orders/order-lifecycle.service';
import { LedgerService } from './ledger.service';
import { PaymentsService } from './payments.service';

const CUSTOMER_NOTIFY: Partial<Record<OrderStatus, string>> = {
  PLACED: 'notif.order.PLACED.title',
  ACCEPTED: 'notif.order.ACCEPTED.title',
  PREPARING: 'notif.order.PREPARING.title',
  READY: 'notif.order.READY.title',
  OUT_FOR_DELIVERY: 'notif.order.OUT_FOR_DELIVERY.title',
  DELIVERED: 'notif.order.DELIVERED.title',
  CANCELLED: 'notif.order.CANCELLED.title',
  REJECTED: 'notif.order.REJECTED.title',
  REFUNDED: 'notif.order.REFUNDED.title',
};

/** Reacts to committed order transitions: notifications, COD capture, settlement ledger, automatic refunds. */
@Injectable()
export class OrderEffectsService {
  private readonly log = new Logger('order-effects');
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly ledger: LedgerService,
    private readonly payments: PaymentsService,
    private readonly analytics: AnalyticsService,
  ) {}

  @OnEvent(ORDER_TRANSITIONED, { async: false, promisify: true })
  async onTransition(e: TransitionEvent) {
    try {
      const order = await this.prisma.order.findUnique({
        where: { id: e.orderId },
        include: { kitchen: { select: { ownerId: true } } },
      });
      if (!order) return;
      const data = { orderId: order.id, status: e.to };

      const key = CUSTOMER_NOTIFY[e.to];
      if (key)
        await this.notifications.notify(
          order.customerId,
          'order',
          key,
          { no: order.orderNo },
          data,
        );
      if (e.to === 'PLACED')
        await this.notifications.notify(
          order.kitchen.ownerId,
          'order',
          'notif.order.new.title',
          { no: order.orderNo },
          data,
        );
      if (e.to === 'CANCELLED' && e.actor.type === 'CUSTOMER')
        await this.notifications.notify(
          order.kitchen.ownerId,
          'order',
          'notif.order.CANCELLED.title',
          { no: order.orderNo },
          data,
        );
      if (e.to === 'PLACED')
        this.analytics.track('order_created', order.customerId, { orderId: order.id });

      if (e.to === 'DELIVERED' && order.paymentMethod === 'CASH_ON_DELIVERY')
        await this.captureCash(order.id);
      if (e.to === 'COMPLETED') {
        await this.ledger.settle(this.prisma, order);
        this.analytics.track('order_completed', order.customerId, { orderId: order.id });
      }
      if ((e.to === 'CANCELLED' || e.to === 'REJECTED') && order.paymentMethod === 'CARD') {
        const paid = await this.prisma.payment.findFirst({
          where: { orderId: order.id, status: 'SUCCEEDED' },
          select: { id: true },
        });
        if (paid)
          await this.payments.refundOrder(order.id, {
            actor: { type: 'SYSTEM' },
            reason: e.reason ?? e.to,
            idempotencyKey: `auto:${order.id}:${e.to}`,
          });
      }
    } catch (err) {
      this.log.error(`effects failed for order ${e.orderId} -> ${e.to}: ${(err as Error).message}`);
    }
  }

  private async captureCash(orderId: string) {
    await this.prisma.$transaction(async (tx) => {
      const order = await tx.order.findUniqueOrThrow({ where: { id: orderId } });
      const p = await tx.payment.findFirst({
        where: { orderId, method: 'CASH_ON_DELIVERY', status: 'PENDING' },
      });
      if (!p) return;
      await tx.payment.update({ where: { id: p.id }, data: { status: 'SUCCEEDED' } });
      await tx.paymentTransaction.create({
        data: {
          paymentId: p.id,
          type: 'CAPTURE',
          amountMinor: p.amountMinor,
          status: 'cash_collected',
        },
      });
      await this.ledger.capture(tx, order, p.id);
    });
  }
}
