import { Module } from '@nestjs/common';
import { OrdersModule } from '../orders/orders.module';
import { LedgerService } from './ledger.service';
import { OrderEffectsService } from './order-effects.service';
import { PaymentsController, SandboxPaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';
import { PaymentProvider, SandboxPaymentProvider } from './provider';

@Module({
  imports: [OrdersModule],
  controllers: [PaymentsController, ...(process.env.PAYMENT_PROVIDER === 'sandbox' || !process.env.PAYMENT_PROVIDER ? [SandboxPaymentsController] : [])],
  providers: [
    SandboxPaymentProvider,
    { provide: PaymentProvider, useExisting: SandboxPaymentProvider },
    PaymentsService, LedgerService, OrderEffectsService,
  ],
  exports: [PaymentsService, LedgerService],
})
export class PaymentsModule {}
