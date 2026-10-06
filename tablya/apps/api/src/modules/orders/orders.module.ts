import { Module } from '@nestjs/common';
import { OrderLifecycleService } from './order-lifecycle.service';
import { OrdersController } from './orders.controller';
import { OrdersService } from './orders.service';
import { PricingService } from './pricing.service';

@Module({
  controllers: [OrdersController],
  providers: [PricingService, OrderLifecycleService, OrdersService],
  exports: [PricingService, OrderLifecycleService, OrdersService],
})
export class OrdersModule {}
