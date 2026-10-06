import { Module } from '@nestjs/common';
import { OrdersModule } from '../orders/orders.module';
import { PaymentsModule } from '../payments/payments.module';
import { CheckoutController } from './checkout.controller';

@Module({ imports: [OrdersModule, PaymentsModule], controllers: [CheckoutController] })
export class CheckoutModule {}
