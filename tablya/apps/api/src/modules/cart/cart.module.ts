import { Module } from '@nestjs/common';
import { OrdersModule } from '../orders/orders.module';
import { CartController } from './cart.controller';

@Module({ imports: [OrdersModule], controllers: [CartController] })
export class CartModule {}
