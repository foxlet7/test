import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { AuthUser, CurrentUser } from '../../common/auth';
import { z$ } from '../../common/zod.pipe';
import { OrdersService } from './orders.service';

const cancelSchema = z.object({ reason: z.string().trim().max(300).optional() });

@ApiTags('orders')
@ApiBearerAuth()
@Controller('orders')
export class OrdersController {
  constructor(private readonly orders: OrdersService) {}

  @Get()
  list(@CurrentUser() u: AuthUser, @Query('cursor') cursor?: string) {
    return this.orders.listForCustomer(u.id, cursor);
  }

  @Get(':id')
  get(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.orders.getForCustomer(u.id, id);
  }

  @Post(':id/cancel')
  cancel(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body(z$(cancelSchema)) b: z.infer<typeof cancelSchema>) {
    return this.orders.customerTransition(u.id, id, 'CANCELLED', b.reason ?? 'Cancelled by customer');
  }

  /** Customer confirms receipt. */
  @Post(':id/confirm-received')
  confirm(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.orders.customerTransition(u.id, id, 'COMPLETED');
  }
}
