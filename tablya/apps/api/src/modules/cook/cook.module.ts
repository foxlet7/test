import { Module } from '@nestjs/common';
import { OrdersModule } from '../orders/orders.module';
import { PaymentsModule } from '../payments/payments.module';
import { CookController } from './cook.controller';
import { KitchenAccess } from './kitchen-access';

@Module({ imports: [OrdersModule, PaymentsModule], controllers: [CookController], providers: [KitchenAccess], exports: [KitchenAccess] })
export class CookModule {}
