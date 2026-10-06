import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { cartItemSchema, checkoutSchema } from '@tablya/shared';
import { z } from 'zod';
import { AnalyticsService } from '../../common/analytics.service';
import { AuthUser, CurrentUser } from '../../common/auth';
import { AppError } from '../../common/errors';
import { PrismaService } from '../../common/prisma.service';
import { z$ } from '../../common/zod.pipe';
import { PricingService } from '../orders/pricing.service';
import { UploadsService } from '../uploads/uploads.service';

const quoteSchema = checkoutSchema.pick({ addressId: true, fulfillment: true, couponCode: true });
const qtySchema = z.object({ quantity: z.number().int().min(1).max(50), note: z.string().trim().max(300).nullable().optional() });

@ApiTags('cart')
@ApiBearerAuth()
@Controller()
export class CartController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly pricing: PricingService,
    private readonly uploads: UploadsService,
    private readonly analytics: AnalyticsService,
  ) {}

  private async view(userId: string, opt: { fulfillment: 'DELIVERY' | 'PICKUP'; addressId?: string; couponCode?: string } = { fulfillment: 'PICKUP' }) {
    const cart = await this.prisma.cart.findUnique({ where: { customerId: userId }, include: { items: { orderBy: { id: 'asc' } } } });
    if (!cart || !cart.kitchenId || !cart.items.length) {
      return { kitchenId: null, lines: [], pricing: null, issues: [], currency: null };
    }
    const q = await this.pricing.quote(cart.kitchenId, cart.items.map((i) => ({ id: i.id, menuItemId: i.menuItemId, quantity: i.quantity, optionIds: i.optionIds, note: i.note })), { ...opt, customerId: userId });
    return { ...q, lines: q.lines.map((l) => ({ ...l, imageUrl: this.uploads.url(l.imageKey) })) };
  }

  @Get('cart')
  cart(@CurrentUser() u: AuthUser) {
    return this.view(u.id);
  }

  /** Authoritative price preview for checkout (address/fulfillment/coupon aware). */
  @Post('checkout/quote')
  quote(@CurrentUser() u: AuthUser, @Body(z$(quoteSchema)) b: z.infer<typeof quoteSchema>) {
    this.analytics.track('checkout_started', u.id);
    return this.view(u.id, b);
  }

  @Post('cart/items')
  async add(@CurrentUser() u: AuthUser, @Body(z$(cartItemSchema)) b: z.infer<typeof cartItemSchema>, @Query('replace') replace?: string) {
    const item = await this.prisma.menuItem.findFirst({ where: { id: b.menuItemId, deletedAt: null, kitchen: { verification: 'VERIFIED', deletedAt: null } }, select: { id: true, kitchenId: true, isAvailable: true } });
    if (!item || !item.isAvailable) throw new AppError('ITEM_UNAVAILABLE', 'This item is not available.');
    await this.prisma.$transaction(async (tx) => {
      const cart = await tx.cart.upsert({ where: { customerId: u.id }, create: { customerId: u.id, kitchenId: item.kitchenId }, update: {} });
      if (cart.kitchenId && cart.kitchenId !== item.kitchenId) {
        const count = await tx.cartItem.count({ where: { cartId: cart.id } });
        if (count > 0 && replace !== 'true') throw new AppError('CART_MIXED_KITCHENS', 'Your cart has items from another kitchen. Start a new cart?');
        await tx.cartItem.deleteMany({ where: { cartId: cart.id } });
      }
      await tx.cart.update({ where: { id: cart.id }, data: { kitchenId: item.kitchenId } });
      if ((await tx.cartItem.count({ where: { cartId: cart.id } })) >= 50) throw new AppError('CONFLICT', 'Cart is full.');
      await tx.cartItem.create({ data: { cartId: cart.id, menuItemId: b.menuItemId, quantity: b.quantity, optionIds: b.optionIds, note: b.note } });
    });
    this.analytics.track('add_to_cart', u.id, { itemId: b.menuItemId });
    return this.view(u.id);
  }

  @Patch('cart/items/:id')
  async update(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body(z$(qtySchema)) b: z.infer<typeof qtySchema>) {
    const r = await this.prisma.cartItem.updateMany({ where: { id, cart: { customerId: u.id } }, data: { quantity: b.quantity, ...(b.note !== undefined ? { note: b.note } : {}) } });
    if (!r.count) throw new AppError('NOT_FOUND', 'Cart item not found.');
    return this.view(u.id);
  }

  @Delete('cart/items/:id')
  async remove(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    await this.prisma.cartItem.deleteMany({ where: { id, cart: { customerId: u.id } } });
    return this.view(u.id);
  }

  @Delete('cart')
  async clear(@CurrentUser() u: AuthUser) {
    await this.prisma.cart.deleteMany({ where: { customerId: u.id } });
    return { ok: true };
  }

}
