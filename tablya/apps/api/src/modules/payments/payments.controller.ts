import { Body, Controller, Headers, HttpCode, Param, Post, RawBodyRequest, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiExcludeController, ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { Request } from 'express';
import { z } from 'zod';
import { AuthUser, CurrentUser, Public } from '../../common/auth';
import { AppError } from '../../common/errors';
import { PrismaService } from '../../common/prisma.service';
import { z$ } from '../../common/zod.pipe';
import { PaymentsService } from './payments.service';
import { SandboxPaymentProvider } from './provider';

@ApiTags('payments')
@Controller('payments')
export class PaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  /** Gateway → us. Authenticated by signature over the raw body, never by user token. */
  @Public() @SkipThrottle() @HttpCode(200) @Post('webhooks/:provider')
  webhook(@Param('provider') provider: string, @Req() req: RawBodyRequest<Request>) {
    if (provider !== 'sandbox' || !req.rawBody) throw new AppError('NOT_FOUND', 'Unknown provider.');
    return this.payments.handleWebhook(req.rawBody, req.headers);
  }
}

/**
 * Stand-in for the gateway's hosted payment page. Mounted only when the sandbox provider is active
 * (development/test). It still goes through signature verification and the normal webhook pipeline.
 */
@ApiTags('payments')
@ApiBearerAuth()
@Controller('payments/sandbox')
export class SandboxPaymentsController {
  constructor(private readonly payments: PaymentsService, private readonly provider: SandboxPaymentProvider, private readonly prisma: PrismaService) {}

  @HttpCode(200) @Post(':providerRef/complete')
  async complete(@CurrentUser() u: AuthUser, @Param('providerRef') providerRef: string, @Body(z$(z.object({ outcome: z.enum(['success', 'fail']) }))) b: { outcome: 'success' | 'fail' }) {
    const p = await this.prisma.payment.findFirst({ where: { providerRef, order: { customerId: u.id } } });
    if (!p) throw new AppError('NOT_FOUND', 'Payment not found.');
    return this.payments.simulateProviderEvent((e) => this.provider.sign(e), {
      id: `evt_${providerRef}_${b.outcome}_${Date.now()}`,
      type: b.outcome === 'success' ? 'payment.succeeded' : 'payment.failed',
      providerRef, amountMinor: p.amountMinor, reason: b.outcome === 'fail' ? 'card_declined' : undefined,
    });
  }
}
