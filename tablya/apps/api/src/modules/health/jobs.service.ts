import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { AppConfig, CONFIG } from '../../config/config';
import { PrismaService } from '../../common/prisma.service';
import { OrderLifecycleService } from '../orders/order-lifecycle.service';
import { PaymentsService } from '../payments/payments.service';

/**
 * Background reconciliation. Every step is idempotent and safe to run concurrently on several instances
 * (state changes go through compare-and-set transitions). With multiple replicas, run the scheduler on one
 * instance or move these to a queue worker — see ARCHITECTURE.md.
 */
@Injectable()
export class JobsService {
  private readonly log = new Logger('jobs');
  private running = false;
  constructor(
    private readonly prisma: PrismaService,
    private readonly lifecycle: OrderLifecycleService,
    private readonly payments: PaymentsService,
    @Inject(CONFIG) private readonly cfg: AppConfig,
  ) {}

  @Cron(CronExpression.EVERY_MINUTE)
  async tick() {
    if (this.running || this.cfg.NODE_ENV === 'test') return;
    this.running = true;
    try {
      await this.runOnce();
    } catch (e) {
      this.log.error(`job tick failed: ${(e as Error).message}`);
    } finally {
      this.running = false;
    }
  }

  async runOnce(now = new Date()) {
    const mins = (m: number) => new Date(now.getTime() - m * 60_000);
    const result = { placed: 0, expired: 0, rejected: 0, completed: 0, refundsRetried: 0, cleaned: 0 };

    // 1. Payment captured but the order was never advanced (crash between payment commit and transition).
    const stuck = await this.prisma.order.findMany({ where: { status: 'PENDING_PAYMENT', payments: { some: { status: 'SUCCEEDED' } } }, select: { id: true }, take: 100 });
    for (const o of stuck) if (await this.safe(() => this.lifecycle.transition(o.id, 'PLACED', { type: 'SYSTEM' }))) result.placed++;

    // 2. Unpaid orders expire (late payments are auto-refunded by the webhook handler).
    const unpaid = await this.prisma.order.findMany({ where: { status: 'PENDING_PAYMENT', paymentMethod: 'CARD', createdAt: { lt: mins(this.cfg.UNPAID_ORDER_TTL_MINUTES) }, payments: { none: { status: 'SUCCEEDED' } } }, select: { id: true }, take: 100 });
    for (const o of unpaid) if (await this.safe(() => this.lifecycle.transition(o.id, 'CANCELLED', { type: 'SYSTEM' }, 'Payment not completed in time'))) result.expired++;

    // 3. Kitchen never responded.
    const idle = await this.prisma.order.findMany({ where: { status: 'PLACED', placedAt: { lt: mins(this.cfg.COOK_ACCEPT_TTL_MINUTES) } }, select: { id: true }, take: 100 });
    for (const o of idle) if (await this.safe(() => this.lifecycle.transition(o.id, 'REJECTED', { type: 'SYSTEM' }, 'Kitchen did not respond in time'))) result.rejected++;

    // 4. Customer never confirmed receipt.
    const delivered = await this.prisma.order.findMany({ where: { status: 'DELIVERED', deliveredAt: { lt: new Date(now.getTime() - this.cfg.AUTO_COMPLETE_HOURS * 3_600_000) } }, select: { id: true }, take: 100 });
    for (const o of delivered) if (await this.safe(() => this.lifecycle.transition(o.id, 'COMPLETED', { type: 'SYSTEM' }))) result.completed++;

    // 5. Refunds stuck in PENDING (provider outage): ask the provider again — same idempotency key, so no double refund.
    const refunding = await this.prisma.order.findMany({ where: { status: 'REFUND_PENDING', paymentMethod: 'CARD' }, select: { id: true }, take: 50 });
    for (const o of refunding) if (await this.safe(() => this.payments.refundOrder(o.id, { actor: { type: 'SYSTEM' }, reason: 'Refund retry', idempotencyKey: `retry:${o.id}` }))) result.refundsRetried++;

    // 6. Housekeeping.
    result.cleaned += (await this.prisma.idempotencyKey.deleteMany({ where: { createdAt: { lt: new Date(now.getTime() - 86_400_000) } } })).count;
    result.cleaned += (await this.prisma.otpCode.deleteMany({ where: { expiresAt: { lt: new Date(now.getTime() - 86_400_000) } } })).count;
    result.cleaned += (await this.prisma.refreshToken.deleteMany({ where: { expiresAt: { lt: new Date(now.getTime() - 7 * 86_400_000) } } })).count;
    return result;
  }

  private async safe(fn: () => Promise<unknown>) {
    try {
      await fn();
      return true;
    } catch (e) {
      this.log.warn(`job step skipped: ${(e as Error).message}`);
      return false;
    }
  }
}
