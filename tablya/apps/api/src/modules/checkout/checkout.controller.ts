import { Body, Controller, Headers, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiTags } from '@nestjs/swagger';
import { checkoutSchema } from '@tablya/shared';
import { z } from 'zod';
import { AnalyticsService } from '../../common/analytics.service';
import { AuthUser, CurrentUser } from '../../common/auth';
import { AppError } from '../../common/errors';
import { z$ } from '../../common/zod.pipe';
import { OrdersService } from '../orders/orders.service';
import { PaymentsService } from '../payments/payments.service';
import { PrismaService } from '../../common/prisma.service';

@ApiTags('checkout')
@ApiBearerAuth()
@Controller('orders')
export class CheckoutController {
  constructor(
    private readonly orders: OrdersService,
    private readonly payments: PaymentsService,
    private readonly prisma: PrismaService,
    private readonly analytics: AnalyticsService,
  ) {}

  /**
   * Creates the order from the server-side cart. Requires an `Idempotency-Key` header (client-generated UUID,
   * reused when retrying after a timeout) so a double tap or network retry can never create a second order.
   */
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @Post()
  async create(@CurrentUser() u: AuthUser, @Headers('idempotency-key') key: string | undefined, @Body(z$(checkoutSchema)) b: z.infer<typeof checkoutSchema>) {
    if (!key || !/^[\w-]{16,80}$/.test(key)) throw new AppError('VALIDATION_FAILED', 'A valid Idempotency-Key header (16-80 chars) is required.');
    const { order, replayed } = await this.orders.create({ customerId: u.id, idempotencyKey: key, ...b });
    if (replayed) return { order, payment: null, replayed };

    this.analytics.track('payment_started', u.id, { method: b.paymentMethod });
    const row = await this.prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    if (b.paymentMethod === 'CASH_ON_DELIVERY') {
      await this.payments.placeCashOrder(row);
      return { order: await this.orders.getForCustomer(u.id, order.id), payment: null, replayed: false };
    }
    const payment = await this.payments.startCardPayment(u.id, order.id);
    return { order, payment, replayed: false };
  }

  /** Retry / resume payment for an order still awaiting payment (failed card, app closed mid-payment). */
  @Post(':id/pay')
  async pay(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return { payment: await this.payments.startCardPayment(u.id, id) };
  }
}
