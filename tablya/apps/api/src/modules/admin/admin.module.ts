import { Module } from '@nestjs/common';
import { OrdersModule } from '../orders/orders.module';
import { PaymentsModule } from '../payments/payments.module';
import { AdminController } from './admin.controller';

@Module({ imports: [OrdersModule, PaymentsModule], controllers: [AdminController] })
export class AdminModule {}
