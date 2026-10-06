import { Injectable, Logger } from '@nestjs/common';
import { Order, Payment, Prisma } from '@prisma/client';
import { createHash } from 'crypto';
import { AppError } from '../../common/errors';
import { AuditService } from '../../common/audit.service';
import { PrismaService } from '../../common/prisma.service';
import { Actor, OrderLifecycleService } from '../orders/order-lifecycle.service';
import { LedgerService } from './ledger.service';
import { PaymentProvider, ProviderEvent } from './provider';

@Injectable()
export class PaymentsService {
  private readonly log = new Logger('payments');
  constructor(
    private readonly prisma: PrismaService,
    private readonly provider: PaymentProvider,
    private readonly lifecycle: OrderLifecycleService,
    private readonly ledger: LedgerService,
    private readonly audit: AuditService,
  ) {}

  // ───────── Starting payment ─────────

  /** Cash on delivery needs no gateway: record the intent and place the order for the kitchen. */
  async placeCashOrder(order: Order) {
    await this.prisma.payment.create({
      data: {
        orderId: order.id,
        provider: 'cod',
        method: 'CASH_ON_DELIVERY',
        status: 'PENDING',
        amountMinor: order.totalMinor,
        currency: order.currency,
        idempotencyKey: `cod:${order.id}`,
      },
    });
    await this.lifecycle.transition(order.id, 'PLACED', { type: 'SYSTEM' });
  }

  /**
   * Starts (or restarts) a card payment attempt. Safe to call repeatedly: earlier unfinished attempts are
   * cancelled, and a double-tap collides on the attempt-numbered idempotency key and returns the live attempt.
   */
  async startCardPayment(customerId: string, orderId: string) {
    const order = await this.prisma.order.findFirst({ where: { id: orderId, customerId } });
    if (!order) throw new AppError('NOT_FOUND', 'Order not found.');
    if (order.paymentMethod !== 'CARD' || order.status !== 'PENDING_PAYMENT') {
      throw new AppError('CONFLICT', 'This order is not awaiting card payment.');
    }
    const live = await this.prisma.payment.findFirst({
      where: { orderId, status: { in: ['INITIATED', 'PENDING'] } },
      orderBy: { createdAt: 'desc' },
    });
    if (live?.providerRef && Date.now() - live.createdAt.getTime() < 60_000) {
      return this.session(live); // same attempt within a minute: idempotent replay (double tap / retry after timeout)
    }
    const attempt = (await this.prisma.payment.count({ where: { orderId } })) + 1;
    let payment: Payment;
    try {
      payment = await this.prisma.$transaction(async (tx) => {
        await tx.payment.updateMany({
          where: { orderId, status: { in: ['INITIATED', 'PENDING'] } },
          data: { status: 'CANCELLED' },
        });
        return tx.payment.create({
          data: {
            orderId,
            provider: this.provider.name,
            method: 'CARD',
            status: 'INITIATED',
            amountMinor: order.totalMinor,
            currency: order.currency,
            idempotencyKey: `pay:${orderId}:${attempt}`,
          },
        });
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        const again = await this.prisma.payment.findFirst({
          where: { orderId, status: { in: ['INITIATED', 'PENDING'] } },
          orderBy: { createdAt: 'desc' },
        });
        if (again) return this.session(again);
      }
      throw e;
    }
    try {
      const res = await this.provider.initiate({
        paymentId: payment.id,
        orderId,
        amountMinor: payment.amountMinor,
        currency: payment.currency,
        idempotencyKey: payment.idempotencyKey,
      });
      payment = await this.prisma.payment.update({
        where: { id: payment.id },
        data: { providerRef: res.providerRef, status: 'PENDING' },
      });
      return {
        ...this.session(payment),
        clientSession: { ...res.clientSession, providerRef: res.providerRef },
      };
    } catch (e) {
      await this.prisma.payment.update({
        where: { id: payment.id },
        data: { status: 'FAILED', failureReason: 'initiate_failed' },
      });
      this.log.error(`provider initiate failed for order ${orderId}: ${(e as Error).message}`);
      throw new AppError('PAYMENT_FAILED', 'We could not start the payment. Please try again.');
    }
  }

  private session(p: Payment) {
    return {
      paymentId: p.id,
      providerRef: p.providerRef,
      status: p.status,
      amountMinor: p.amountMinor,
      currency: p.currency,
      clientSession: { providerRef: p.providerRef ?? '' },
    };
  }

  // ───────── Webhooks ─────────

  async handleWebhook(rawBody: Buffer, headers: Record<string, string | string[] | undefined>) {
    const event = this.provider.parseWebhook(rawBody, headers);
    if (!event) {
      let parsed: Prisma.InputJsonValue = {};
      try {
        parsed = JSON.parse(rawBody.toString('utf8').slice(0, 10_000));
      } catch {
        /* keep {} */
      }
      await this.prisma.webhookEvent.create({
        data: {
          provider: this.provider.name,
          eventId: `invalid:${createHash('sha256').update(rawBody).digest('hex').slice(0, 24)}:${Date.now()}`,
          type: 'invalid',
          payload: parsed,
          signatureValid: false,
        },
      });
      throw new AppError('UNAUTHENTICATED', 'Invalid webhook signature.');
    }

    try {
      await this.prisma.webhookEvent.create({
        data: {
          provider: this.provider.name,
          eventId: event.id,
          type: event.type,
          payload: event as unknown as Prisma.InputJsonValue,
          signatureValid: true,
        },
      });
    } catch (e) {
      if (!(e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002')) throw e;
      const prior = await this.prisma.webhookEvent.findUniqueOrThrow({
        where: { provider_eventId: { provider: this.provider.name, eventId: event.id } },
      });
      if (prior.processedAt) return { duplicate: true }; // safe retry from the gateway: acknowledge, do nothing
      // Previously received but processing failed: fall through and process again.
    }

    try {
      await this.process(event);
      await this.prisma.webhookEvent.update({
        where: { provider_eventId: { provider: this.provider.name, eventId: event.id } },
        data: { processedAt: new Date(), error: null },
      });
      return { duplicate: false };
    } catch (e) {
      await this.prisma.webhookEvent.update({
        where: { provider_eventId: { provider: this.provider.name, eventId: event.id } },
        data: { error: (e as Error).message.slice(0, 500) },
      });
      throw e; // non-2xx => gateway retries later
    }
  }

  private async process(e: ProviderEvent) {
    switch (e.type) {
      case 'payment.succeeded':
        return this.onPaymentSucceeded(e);
      case 'payment.failed':
        return this.onPaymentFailed(e);
      case 'refund.succeeded':
        return this.onRefundResult(e, true);
      case 'refund.failed':
        return this.onRefundResult(e, false);
    }
  }

  private async onPaymentSucceeded(e: ProviderEvent) {
    const { payment, order, placed } = await this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<
        { id: string }[]
      >`SELECT id FROM "Payment" WHERE provider = ${this.provider.name} AND "providerRef" = ${e.providerRef} FOR UPDATE`;
      if (!rows.length) throw new AppError('NOT_FOUND', 'Unknown payment reference.');
      const payment = await tx.payment.findUniqueOrThrow({ where: { id: rows[0].id } });
      const order = await tx.order.findUniqueOrThrow({ where: { id: payment.orderId } });
      if (
        payment.status === 'SUCCEEDED' ||
        payment.status === 'REFUNDED' ||
        payment.status === 'PARTIALLY_REFUNDED'
      )
        return { payment, order, placed: false };
      if (e.amountMinor != null && e.amountMinor !== payment.amountMinor) {
        await tx.payment.update({
          where: { id: payment.id },
          data: { status: 'FAILED', failureReason: 'amount_mismatch' },
        });
        this.log.error(
          `AMOUNT MISMATCH payment=${payment.id} expected=${payment.amountMinor} got=${e.amountMinor}`,
        );
        return { payment, order, placed: false };
      }
      // A newer attempt may already have succeeded for the same order; the partial unique index forbids two.
      const updated = await tx.payment.update({
        where: { id: payment.id },
        data: { status: 'SUCCEEDED', failureReason: null },
      });
      await tx.paymentTransaction.create({
        data: {
          paymentId: payment.id,
          type: 'CAPTURE',
          amountMinor: payment.amountMinor,
          status: 'succeeded',
          providerTxId: e.id,
          raw: e as unknown as Prisma.InputJsonValue,
        },
      });
      await this.ledger.capture(tx, order, payment.id);
      return { payment: updated, order, placed: true };
    });
    if (!placed) return;
    if (order.status === 'PENDING_PAYMENT') {
      await this.lifecycle.transition(order.id, 'PLACED', { type: 'SYSTEM' });
    } else if (order.status === 'CANCELLED' || order.status === 'REJECTED') {
      // Money arrived after the order was cancelled/expired: give it straight back.
      await this.refundOrder(order.id, {
        actor: { type: 'SYSTEM' },
        reason: 'Payment received after order was cancelled',
        idempotencyKey: `late:${payment.id}`,
      });
    }
  }

  private async onPaymentFailed(e: ProviderEvent) {
    await this.prisma.payment.updateMany({
      where: {
        provider: this.provider.name,
        providerRef: e.providerRef,
        status: { in: ['INITIATED', 'PENDING'] },
      },
      data: { status: 'FAILED', failureReason: (e.reason ?? 'declined').slice(0, 200) },
    });
  }

  private async onRefundResult(e: ProviderEvent, ok: boolean) {
    const refund = await this.prisma.refund.findFirst({ where: { providerRef: e.providerRef } });
    if (!refund) throw new AppError('NOT_FOUND', 'Unknown refund reference.');
    if (refund.status !== 'PENDING') return;
    if (ok) await this.finalizeRefund(refund.id);
    else await this.prisma.refund.update({ where: { id: refund.id }, data: { status: 'FAILED' } });
  }

  // ───────── Refunds ─────────

  /**
   * Refunds a card order (fully when `amountMinor` is omitted). Idempotent on `idempotencyKey`.
   * Full refunds drive the order through REFUND_PENDING → REFUNDED.
   */
  async refundOrder(
    orderId: string,
    o: {
      actor: Actor;
      reason: string;
      idempotencyKey: string;
      amountMinor?: number;
      platformFunded?: boolean;
    },
  ) {
    const order = await this.prisma.order.findUnique({ where: { id: orderId } });
    if (!order) throw new AppError('NOT_FOUND', 'Order not found.');
    const payment = await this.prisma.payment.findFirst({
      where: { orderId, method: 'CARD', status: { in: ['SUCCEEDED', 'PARTIALLY_REFUNDED'] } },
    });
    if (!payment)
      throw new AppError(
        'CONFLICT',
        'No captured card payment to refund (cash orders are settled outside the platform).',
      );

    const refund = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Payment" WHERE id = ${payment.id}::uuid FOR UPDATE`;
      const existing = await tx.refund.findUnique({ where: { idempotencyKey: o.idempotencyKey } });
      if (existing) return { row: existing, created: false };
      const agg = await tx.refund.aggregate({
        where: { paymentId: payment.id, status: { in: ['PENDING', 'SUCCEEDED'] } },
        _sum: { amountMinor: true },
      });
      const already = agg._sum.amountMinor ?? 0;
      const amount = o.amountMinor ?? payment.amountMinor - already;
      if (amount <= 0 || already + amount > payment.amountMinor)
        throw new AppError('CONFLICT', 'Refund exceeds the amount paid.');
      const completesFull = already + amount === payment.amountMinor;
      // Revenue is only booked at COMPLETED, so a partial refund can only be booked against it afterwards.
      if (!completesFull && order.status !== 'COMPLETED')
        throw new AppError(
          'CONFLICT',
          'Partial refunds are available once the order is completed.',
        );
      const row = await tx.refund.create({
        data: {
          orderId,
          paymentId: payment.id,
          amountMinor: amount,
          reason: o.reason,
          idempotencyKey: o.idempotencyKey,
          createdBy: o.actor.id ?? null,
        },
      });
      return { row, created: true, completesFull };
    });
    if (!refund.created) return refund.row;

    const isFull = refund.completesFull;
    if (isFull && order.status !== 'REFUND_PENDING' && order.status !== 'REFUNDED') {
      await this.lifecycle.transition(orderId, 'REFUND_PENDING', o.actor, o.reason);
    }
    await this.audit.log({
      actorId: o.actor.id,
      actorRole: o.actor.type,
      action: 'REFUND_ISSUED',
      entityType: 'Order',
      entityId: orderId,
      meta: { refundId: refund.row.id, amountMinor: refund.row.amountMinor, reason: o.reason },
    });

    try {
      const res = await this.provider.refund({
        providerRef: payment.providerRef!,
        amountMinor: refund.row.amountMinor,
        idempotencyKey: refund.row.idempotencyKey,
      });
      await this.prisma.refund.update({
        where: { id: refund.row.id },
        data: {
          providerRef: res.providerRef,
          ...(res.status === 'failed' ? { status: 'FAILED' } : {}),
        },
      });
      if (res.status === 'succeeded')
        await this.finalizeRefund(refund.row.id, o.platformFunded ?? false);
    } catch (e) {
      this.log.error(`provider refund failed order=${orderId}: ${(e as Error).message}`); // stays PENDING; reconciliation retries
    }
    return this.prisma.refund.findUniqueOrThrow({ where: { id: refund.row.id } });
  }

  private async finalizeRefund(refundId: string, platformFunded = false) {
    const done = await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.refund.updateMany({
        where: { id: refundId, status: 'PENDING' },
        data: { status: 'SUCCEEDED' },
      });
      if (claimed.count !== 1) return null;
      const refund = await tx.refund.findUniqueOrThrow({ where: { id: refundId } });
      const payment = await tx.payment.findUniqueOrThrow({ where: { id: refund.paymentId } });
      const order = await tx.order.findUniqueOrThrow({ where: { id: refund.orderId } });
      const total =
        (
          await tx.refund.aggregate({
            where: { paymentId: payment.id, status: 'SUCCEEDED' },
            _sum: { amountMinor: true },
          })
        )._sum.amountMinor ?? 0;
      const full = total >= payment.amountMinor;
      await tx.payment.update({
        where: { id: payment.id },
        data: { status: full ? 'REFUNDED' : 'PARTIALLY_REFUNDED' },
      });
      await tx.paymentTransaction.create({
        data: {
          paymentId: payment.id,
          type: 'REFUND',
          amountMinor: refund.amountMinor,
          status: 'succeeded',
          providerTxId: refund.providerRef,
        },
      });
      await this.ledger.refund(tx, order, refund.id, refund.amountMinor, {
        completesFull: full,
        platformFunded,
      });
      return { order, full };
    });
    if (done?.full) {
      const cur = await this.prisma.order.findUniqueOrThrow({ where: { id: done.order.id } });
      if (cur.status === 'REFUND_PENDING')
        await this.lifecycle.transition(cur.id, 'REFUNDED', { type: 'SYSTEM' });
    }
  }

  /** Dev-only helper used by the sandbox completion endpoint: emits a correctly signed event through the real webhook path. */
  async simulateProviderEvent(
    sign: (e: ProviderEvent) => { body: string; signature: string },
    e: ProviderEvent,
  ) {
    const { body, signature } = sign(e);
    return this.handleWebhook(Buffer.from(body), { 'x-tablya-signature': signature });
  }
}
