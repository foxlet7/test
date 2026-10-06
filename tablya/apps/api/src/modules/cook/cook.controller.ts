import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Prisma } from '@prisma/client';
import { normalizeSearch } from '@tablya/shared';
import { z } from 'zod';
import { AuditService } from '../../common/audit.service';
import { AuthUser, CurrentUser, Roles } from '../../common/auth';
import { AppError } from '../../common/errors';
import { PrismaService } from '../../common/prisma.service';
import { z$ } from '../../common/zod.pipe';
import { KitchenPresenter } from '../catalog/kitchen.presenter';
import { OrderLifecycleService } from '../orders/order-lifecycle.service';
import { OrdersService } from '../orders/orders.service';
import { LedgerService } from '../payments/ledger.service';
import { UploadsService } from '../uploads/uploads.service';
import { KitchenAccess } from './kitchen-access';
import {
  availabilitySchema,
  kitchenCreateSchema,
  kitchenUpdateSchema,
  menuItemSchema,
  menuItemUpdateSchema,
  scheduleSchema,
  transitionSchema,
  zonesSchema,
} from './cook.schemas';

type KitchenBody = z.infer<typeof kitchenCreateSchema>;

@ApiTags('cook')
@ApiBearerAuth()
@Roles('COOK', 'KITCHEN_MANAGER')
@Controller('cook')
export class CookController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: KitchenAccess,
    private readonly audit: AuditService,
    private readonly uploads: UploadsService,
    private readonly lifecycle: OrderLifecycleService,
    private readonly orders: OrdersService,
    private readonly ledger: LedgerService,
    private readonly presenter: KitchenPresenter,
  ) {}

  private async searchText(
    name: string,
    nameAr: string | null | undefined,
    extra: (string | null | undefined)[],
  ) {
    return normalizeSearch([name, nameAr, ...extra].filter(Boolean).join(' '));
  }

  private async kitchenSearchText(
    b: { name: string; nameAr?: string | null; description?: string | null; city: string },
    cuisineIds: string[],
  ) {
    const cuisines = cuisineIds.length
      ? await this.prisma.cuisine.findMany({ where: { id: { in: cuisineIds } } })
      : [];
    return this.searchText(b.name, b.nameAr, [
      b.description,
      b.city,
      ...cuisines.flatMap((c) => [c.name, c.nameAr]),
    ]);
  }

  // ───────── Kitchens ─────────
  @Get('kitchens')
  async myKitchens(@CurrentUser() u: AuthUser) {
    const rows = await this.prisma.kitchen.findMany({
      where: { ownerId: u.id, deletedAt: null },
      include: {
        schedule: true,
        zones: true,
        cuisines: { include: { cuisine: true } },
        verifications: { orderBy: { createdAt: 'desc' }, take: 1 },
      },
    });
    return rows.map((k) => ({
      ...k,
      coverUrl: this.uploads.url(k.coverKey),
      galleryUrls: k.galleryKeys.map((g) => this.uploads.url(g)),
      verificationNote: k.verifications[0]?.note ?? null,
      verifications: undefined,
    }));
  }

  @Post('kitchens')
  async create(@CurrentUser() u: AuthUser, @Body(z$(kitchenCreateSchema)) b: KitchenBody) {
    if ((await this.prisma.kitchen.count({ where: { ownerId: u.id, deletedAt: null } })) >= 3)
      throw new AppError('CONFLICT', 'Kitchen limit reached.');
    await this.uploads.assertOwned(
      u.id,
      [...(b.coverKey ? [b.coverKey] : []), ...(b.galleryKeys ?? [])],
      'kitchen',
    );
    const { cuisineIds, ...rest } = b;
    const slug = `${
      normalizeSearch(b.name)
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '') || 'kitchen'
    }-${Math.random().toString(36).slice(2, 8)}`;
    const k = await this.prisma.kitchen.create({
      data: {
        ...rest,
        ownerId: u.id,
        slug,
        galleryKeys: b.galleryKeys ?? [],
        searchText: await this.kitchenSearchText(b, cuisineIds),
        cuisines: { create: cuisineIds.map((cuisineId) => ({ cuisineId })) },
        verifications: { create: { status: 'DRAFT' } },
      },
    });
    await this.audit.log({
      actorId: u.id,
      actorRole: 'COOK',
      action: 'KITCHEN_CREATED',
      entityType: 'Kitchen',
      entityId: k.id,
    });
    return k;
  }

  @Patch('kitchens/:id')
  async update(
    @CurrentUser() u: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(z$(kitchenUpdateSchema)) b: Partial<KitchenBody>,
  ) {
    const k = await this.access.assertOwner(u, id);
    await this.uploads.assertOwned(
      u.id,
      [...(b.coverKey ? [b.coverKey] : []), ...(b.galleryKeys ?? [])],
      'kitchen',
    );
    const { cuisineIds, ...rest } = b;
    const merged = {
      name: b.name ?? k.name,
      nameAr: b.nameAr ?? k.nameAr,
      description: b.description ?? k.description,
      city: b.city ?? k.city,
    };
    const existingCuisines =
      cuisineIds ??
      (await this.prisma.kitchenCuisine.findMany({ where: { kitchenId: id } })).map(
        (c) => c.cuisineId,
      );
    return this.prisma.$transaction(async (tx) => {
      if (cuisineIds) {
        await tx.kitchenCuisine.deleteMany({ where: { kitchenId: id } });
        await tx.kitchenCuisine.createMany({
          data: cuisineIds.map((cuisineId) => ({ kitchenId: id, cuisineId })),
        });
      }
      return tx.kitchen.update({
        where: { id },
        data: { ...rest, searchText: await this.kitchenSearchText(merged, existingCuisines) },
      });
    });
  }

  @Put('kitchens/:id/schedule')
  async schedule(
    @CurrentUser() u: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(z$(scheduleSchema)) b: z.infer<typeof scheduleSchema>,
  ) {
    await this.access.assertOwner(u, id);
    await this.prisma.$transaction([
      this.prisma.kitchenSchedule.deleteMany({ where: { kitchenId: id } }),
      this.prisma.kitchenSchedule.createMany({
        data: b.slots.map((s) => ({ ...s, kitchenId: id })),
      }),
    ]);
    return { ok: true };
  }

  @Put('kitchens/:id/zones')
  async zones(
    @CurrentUser() u: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(z$(zonesSchema)) b: z.infer<typeof zonesSchema>,
  ) {
    await this.access.assertOwner(u, id);
    await this.prisma.$transaction([
      this.prisma.deliveryZone.deleteMany({ where: { kitchenId: id } }),
      this.prisma.deliveryZone.createMany({ data: b.zones.map((z) => ({ ...z, kitchenId: id })) }),
    ]);
    return { ok: true };
  }

  /** Pause / resume taking orders (kitchen closes early, is overwhelmed, etc.). */
  @Patch('kitchens/:id/availability')
  async availability(
    @CurrentUser() u: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(z$(availabilitySchema)) b: z.infer<typeof availabilitySchema>,
  ) {
    await this.access.assertOwner(u, id);
    const k = await this.prisma.kitchen.update({
      where: { id },
      data: {
        ...(b.acceptingOrders !== undefined ? { acceptingOrders: b.acceptingOrders } : {}),
        ...(b.pausedUntil !== undefined
          ? { pausedUntil: b.pausedUntil ? new Date(b.pausedUntil) : null }
          : {}),
      },
    });
    return { acceptingOrders: k.acceptingOrders, pausedUntil: k.pausedUntil };
  }

  /** Onboarding: a verification case (DRAFT) is submitted for admin review once the kitchen is complete. */
  @HttpCode(200)
  @Post('kitchens/:id/submit')
  async submit(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    const k = await this.access.assertOwner(u, id);
    if (!['DRAFT', 'REJECTED'].includes(k.verification))
      throw new AppError('CONFLICT', 'This kitchen has already been submitted.');
    const [items, slots, zones, docs] = await Promise.all([
      this.prisma.menuItem.count({ where: { kitchenId: id, deletedAt: null } }),
      this.prisma.kitchenSchedule.count({ where: { kitchenId: id } }),
      this.prisma.deliveryZone.count({ where: { kitchenId: id } }),
      this.prisma.kitchenDocument.count({
        where: { verification: { kitchenId: id, status: 'DRAFT' } },
      }),
    ]);
    const missing = [
      !k.coverKey && 'cover photo',
      !items && 'at least one menu item',
      !slots && 'working hours',
      !zones && !k.pickupEnabled && 'a delivery zone or pickup',
      !docs && 'identity/food-handling document',
    ].filter(Boolean);
    if (missing.length)
      throw new AppError(
        'VALIDATION_FAILED',
        `Complete your kitchen first: ${missing.join(', ')}.`,
        { missing },
      );
    await this.prisma.$transaction(async (tx) => {
      const prior = await tx.kitchenVerification.findFirst({
        where: { kitchenId: id, status: 'DRAFT' },
      });
      if (prior)
        await tx.kitchenVerification.update({
          where: { id: prior.id },
          data: { status: 'SUBMITTED', submittedAt: new Date() },
        });
      else
        await tx.kitchenVerification.create({
          data: { kitchenId: id, status: 'SUBMITTED', submittedAt: new Date() },
        });
      await tx.kitchen.update({ where: { id }, data: { verification: 'SUBMITTED' } });
    });
    await this.audit.log({
      actorId: u.id,
      actorRole: 'COOK',
      action: 'KITCHEN_SUBMITTED',
      entityType: 'Kitchen',
      entityId: id,
    });
    return { verification: 'SUBMITTED' };
  }

  /** Attach a verification document (uploaded with purpose=verification_doc). Visible only to admins. */
  @Post('kitchens/:id/documents')
  async document(
    @CurrentUser() u: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(
      z$(
        z.object({
          type: z.enum(['NATIONAL_ID', 'FOOD_LICENSE', 'HEALTH_CERT', 'OTHER']),
          key: z.string().max(200),
        }),
      ),
    )
    b: { type: string; key: string },
  ) {
    const k = await this.access.assertOwner(u, id);
    if (!['DRAFT', 'REJECTED'].includes(k.verification))
      throw new AppError('CONFLICT', 'Documents can only be changed before submission.');
    await this.uploads.assertOwned(u.id, [b.key], 'verification_doc');
    let v = await this.prisma.kitchenVerification.findFirst({
      where: { kitchenId: id, status: 'DRAFT' },
    });
    if (!v)
      v = await this.prisma.kitchenVerification.create({
        data: { kitchenId: id, status: 'DRAFT' },
      });
    await this.prisma.kitchenDocument.create({
      data: { verificationId: v.id, type: b.type, storageKey: b.key },
    });
    return { ok: true };
  }

  // ───────── Menu ─────────
  @Get('kitchens/:id/menu')
  async menu(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    await this.access.assertOwner(u, id);
    const items = await this.prisma.menuItem.findMany({
      where: { kitchenId: id, deletedAt: null },
      include: { optionGroups: { include: { options: true } } },
      orderBy: { createdAt: 'asc' },
    });
    return items.map((i) => this.presenter.menuItemView(i));
  }

  @Post('kitchens/:id/menu')
  async addItem(
    @CurrentUser() u: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(z$(menuItemSchema)) b: z.infer<typeof menuItemSchema>,
  ) {
    await this.access.assertOwner(u, id);
    await this.uploads.assertOwned(u.id, b.imageKeys, 'menu_item');
    const { optionGroups, ...rest } = b;
    const item = await this.prisma.menuItem.create({
      data: {
        ...rest,
        kitchenId: id,
        searchText: await this.searchText(b.name, b.nameAr, [b.description, ...b.ingredients]),
        optionGroups: {
          create: (optionGroups ?? []).map((g) => ({ ...g, options: { create: g.options } })),
        },
      },
      include: { optionGroups: { include: { options: true } } },
    });
    await this.audit.log({
      actorId: u.id,
      actorRole: 'COOK',
      action: 'MENU_ITEM_CREATED',
      entityType: 'MenuItem',
      entityId: item.id,
      meta: { priceMinor: item.priceMinor },
    });
    return this.presenter.menuItemView(item);
  }

  @Patch('menu/:itemId')
  async editItem(
    @CurrentUser() u: AuthUser,
    @Param('itemId', ParseUUIDPipe) itemId: string,
    @Body(z$(menuItemUpdateSchema)) b: Partial<z.infer<typeof menuItemSchema>>,
  ) {
    const cur = await this.prisma.menuItem.findFirst({ where: { id: itemId, deletedAt: null } });
    if (!cur) throw new AppError('NOT_FOUND', 'Item not found.');
    await this.access.assertOwner(u, cur.kitchenId);
    if (b.imageKeys) await this.uploads.assertOwned(u.id, b.imageKeys, 'menu_item');
    const { optionGroups, ...rest } = b;
    const priceChanged = b.priceMinor !== undefined && b.priceMinor !== cur.priceMinor;
    const updated = await this.prisma.$transaction(async (tx) => {
      if (optionGroups) {
        // Replace-all keeps option ids stable only for unchanged payloads; open carts referencing removed options get re-validated at checkout.
        await tx.menuItemOptionGroup.deleteMany({ where: { menuItemId: itemId } });
        for (const g of optionGroups)
          await tx.menuItemOptionGroup.create({
            data: { ...g, menuItemId: itemId, options: { create: g.options } },
          });
      }
      return tx.menuItem.update({
        where: { id: itemId },
        data: {
          ...rest,
          ...(priceChanged ? { version: { increment: 1 } } : {}),
          searchText: await this.searchText(b.name ?? cur.name, b.nameAr ?? cur.nameAr, [
            b.description ?? cur.description,
            ...(b.ingredients ?? cur.ingredients),
          ]),
        },
        include: { optionGroups: { include: { options: true } } },
      });
    });
    if (priceChanged)
      await this.audit.log({
        actorId: u.id,
        actorRole: 'COOK',
        action: 'PRICE_CHANGED',
        entityType: 'MenuItem',
        entityId: itemId,
        meta: { from: cur.priceMinor, to: b.priceMinor! },
      });
    return this.presenter.menuItemView(updated);
  }

  /** Soft delete: past orders keep their snapshot of the item. */
  @Delete('menu/:itemId')
  async deleteItem(@CurrentUser() u: AuthUser, @Param('itemId', ParseUUIDPipe) itemId: string) {
    const cur = await this.prisma.menuItem.findFirst({ where: { id: itemId, deletedAt: null } });
    if (!cur) throw new AppError('NOT_FOUND', 'Item not found.');
    await this.access.assertOwner(u, cur.kitchenId);
    await this.prisma.menuItem.update({
      where: { id: itemId },
      data: { deletedAt: new Date(), isAvailable: false },
    });
    await this.audit.log({
      actorId: u.id,
      actorRole: 'COOK',
      action: 'MENU_ITEM_DELETED',
      entityType: 'MenuItem',
      entityId: itemId,
    });
    return { ok: true };
  }

  // ───────── Orders ─────────
  @Get('kitchens/:id/orders')
  async kitchenOrders(
    @CurrentUser() u: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Query('scope') scope: 'pending' | 'active' | 'done' | 'today' = 'active',
    @Query('cursor') cursor?: string,
  ) {
    await this.access.assertOwner(u, id);
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    const where: Prisma.OrderWhereInput = {
      kitchenId: id,
      ...(
        {
          pending: { status: 'PLACED' },
          active: { status: { in: ['ACCEPTED', 'PREPARING', 'READY', 'OUT_FOR_DELIVERY'] } },
          done: {
            status: {
              in: ['DELIVERED', 'COMPLETED', 'CANCELLED', 'REJECTED', 'REFUND_PENDING', 'REFUNDED'],
            },
          },
          today: { createdAt: { gte: startOfDay }, status: { not: 'PENDING_PAYMENT' } },
        } as Record<string, Prisma.OrderWhereInput>
      )[scope],
    };
    const rows = await this.prisma.order.findMany({
      where,
      orderBy: [{ createdAt: scope === 'done' ? 'desc' : 'asc' }, { id: 'asc' }],
      take: 31,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      select: { id: true },
    });
    const items = await Promise.all(
      rows.slice(0, 30).map((r) => this.orders.getForKitchen([id], r.id)),
    );
    return { items, nextCursor: rows.length > 30 ? rows[29].id : null };
  }

  @Get('orders/:orderId')
  async order(@CurrentUser() u: AuthUser, @Param('orderId', ParseUUIDPipe) orderId: string) {
    return this.orders.getForKitchen(await this.access.ownedIds(u.id), orderId);
  }

  /** accept / reject / preparing / ready / out-for-delivery / delivered / cancel. The state machine decides legality. */
  @HttpCode(200)
  @Post('orders/:orderId/transition')
  async transition(
    @CurrentUser() u: AuthUser,
    @Param('orderId', ParseUUIDPipe) orderId: string,
    @Body(z$(transitionSchema)) b: z.infer<typeof transitionSchema>,
  ) {
    const ids = await this.access.ownedIds(u.id);
    const order = await this.prisma.order.findFirst({
      where: { id: orderId, kitchenId: { in: ids } },
      select: { id: true },
    });
    if (!order) throw new AppError('NOT_FOUND', 'Order not found.');
    if ((b.to === 'REJECTED' || b.to === 'CANCELLED') && !b.reason)
      throw new AppError('VALIDATION_FAILED', 'Please give the customer a reason.');
    await this.lifecycle.transition(orderId, b.to, { type: 'COOK', id: u.id }, b.reason);
    return this.orders.getForKitchen(ids, orderId);
  }

  // ───────── Dashboard & earnings ─────────
  @Get('kitchens/:id/dashboard')
  async dashboard(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    const k = await this.access.assertOwner(u, id);
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    const [pending, active, today, completedToday, balance, recentReviews] = await Promise.all([
      this.prisma.order.count({ where: { kitchenId: id, status: 'PLACED' } }),
      this.prisma.order.count({
        where: {
          kitchenId: id,
          status: { in: ['ACCEPTED', 'PREPARING', 'READY', 'OUT_FOR_DELIVERY'] },
        },
      }),
      this.prisma.order.count({
        where: {
          kitchenId: id,
          createdAt: { gte: startOfDay },
          status: { not: 'PENDING_PAYMENT' },
        },
      }),
      this.prisma.order.count({
        where: {
          kitchenId: id,
          status: { in: ['DELIVERED', 'COMPLETED'] },
          deliveredAt: { gte: startOfDay },
        },
      }),
      this.ledger.kitchenBalance(id),
      this.prisma.review.count({
        where: {
          kitchenId: id,
          status: 'VISIBLE',
          createdAt: { gte: new Date(Date.now() - 7 * 86_400_000) },
        },
      }),
    ]);
    return {
      kitchen: {
        id: k.id,
        name: k.name,
        verification: k.verification,
        acceptingOrders: k.acceptingOrders,
        pausedUntil: k.pausedUntil,
        ratingAvg: k.ratingAvg,
        ratingCount: k.ratingCount,
      },
      orders: { pending, active, today, completedToday },
      earnings: balance,
      reviewsLast7Days: recentReviews,
    };
  }

  @Get('kitchens/:id/earnings')
  async earnings(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    await this.access.assertOwner(u, id);
    const [balance, entries, payouts] = await Promise.all([
      this.ledger.kitchenBalance(id),
      this.prisma.ledgerEntry.findMany({
        where: { kitchenId: id, account: { in: ['VENDOR_EARNINGS', 'ADJUSTMENT'] } },
        orderBy: { createdAt: 'desc' },
        take: 50,
        select: {
          id: true,
          orderId: true,
          account: true,
          amountMinor: true,
          memo: true,
          createdAt: true,
        },
      }),
      this.prisma.payout.findMany({
        where: { kitchenId: id },
        orderBy: { createdAt: 'desc' },
        take: 20,
      }),
    ]);
    return { balance, entries, payouts };
  }
}
