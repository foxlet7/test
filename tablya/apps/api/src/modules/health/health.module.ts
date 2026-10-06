import { Module } from '@nestjs/common';
import { OrdersModule } from '../orders/orders.module';
import { PaymentsModule } from '../payments/payments.module';
import { HealthController } from './health.controller';
import { JobsService } from './jobs.service';

@Module({
  imports: [OrdersModule, PaymentsModule],
  controllers: [HealthController],
  providers: [JobsService],
  exports: [JobsService],
})
export class HealthModule {}
