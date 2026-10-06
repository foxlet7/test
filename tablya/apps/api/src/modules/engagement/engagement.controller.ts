import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Prisma } from '@prisma/client';
import { reportSchema, reviewSchema } from '@tablya/shared';
import { z } from 'zod';
import { ANALYTICS_EVENTS, AnalyticsService } from '../../common/analytics.service';
import { AuthUser, CurrentUser, Public } from '../../common/auth';
import { AppError } from '../../common/errors';
import { AuthedRequest } from '../../common/filters';
import { PrismaService } from '../../common/prisma.service';
import { z$ } from '../../common/zod.pipe';
import { KitchenPresenter, KITCHEN_INCLUDE, KitchenFull } from '../catalog/kitchen.presenter';
import { NotificationsService } from '../notifications/notifications.service';
import { UploadsService } from '../uploads/uploads.service';

const REVIEW_WINDOW_DAYS = 30;
const EDIT_WINDOW_HOURS = 48;
/** Strip control chars and angle brackets: clients render plain text, this is defence in depth. */
const clean = (s?: string | null) => s?.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F<>]/g, '').trim() || null;

@ApiTags('engagement')
@ApiBearerAuth()
@Controller()
export class EngagementController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly uploads: UploadsService,
    private readonly notifications: NotificationsService,
    private readonly analytics: AnalyticsService,
    private readonly presenter: KitchenPresenter,
  ) {}

  // ───────── Reviews ─────────
  private async recomputeRating(tx: Prisma.TransactionClient, kitchenId: string) {
    const a = await tx.review.aggregate({ where: { kitchenId, status: 'VISIBLE' }, _avg: { rating: true }, _count: { _all: true } });
    await tx.kitchen.update({ where: { id: kitchenId }, data: { ratingAvg: a._avg.rating ?? 0, ratingCount: a._count._all } });
  }

  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('reviews')
  async createReview(@CurrentUser() u: AuthUser, @Body(z$(reviewSchema)) b: z.infer<typeof reviewSchema>) {
    const order = await this.prisma.order.findFirst({ where: { id: b.orderId, customerId: u.id }, include: { kitchen: { select: { ownerId: true } } } });
    const eligible = order && ['DELIVERED', 'COMPLETED'].includes(order.status) && order.deliveredAt && order.deliveredAt > new Date(Date.now() - REVIEW_WINDOW_DAYS * 86_400_000);
    if (!order || !eligible) throw new AppError('REVIEW_NOT_ELIGIBLE', 'You can review an order after it has been delivered.');
    await this.uploads.assertOwned(u.id, b.imageKeys, 'review');
    try {
      const review = await this.prisma.$transaction(async (tx) => {
        const r = await tx.review.create({ data: { orderId: order.id, customerId: u.id, kitchenId: order.kitchenId, rating: b.rating, text: clean(b.text), imageKeys: b.imageKeys } });
        await this.recomputeRating(tx, order.kitchenId);
        return r;
      });
      this.analytics.track('review_created', u.id, { rating: b.rating });
      await this.notifications.notify(order.kitchen.ownerId, 'review', 'notif.order.new.title', {}, { orderId: order.id });
      return review;
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') throw new AppError('REVIEW_NOT_ELIGIBLE', 'You have already reviewed this order.');
      throw e;
    }
  }

  @Patch('reviews/:id')
  async editReview(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body(z$(z.object({ rating: z.number().int().min(1).max(5).optional(), text: z.string().trim().max(1500).optional() }))) b: { rating?: number; text?: string }) {
    const r = await this.prisma.review.findFirst({ where: { id, customerId: u.id } });
    if (!r) throw new AppError('NOT_FOUND', 'Review not found.');
    if (r.createdAt < new Date(Date.now() - EDIT_WINDOW_HOURS * 3_600_000)) throw new AppError('FORBIDDEN', `Reviews can only be edited within ${EDIT_WINDOW_HOURS} hours.`);
    return this.prisma.$transaction(async (tx) => {
      const up = await tx.review.update({ where: { id }, data: { ...(b.rating ? { rating: b.rating } : {}), ...(b.text !== undefined ? { text: clean(b.text) } : {}), editedAt: new Date() } });
      await this.recomputeRating(tx, r.kitchenId);
      return up;
    });
  }

  @Delete('reviews/:id')
  async deleteReview(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    const r = await this.prisma.review.findFirst({ where: { id, customerId: u.id } });
    if (!r) throw new AppError('NOT_FOUND', 'Review not found.');
    await this.prisma.$transaction(async (tx) => {
      await tx.review.delete({ where: { id } });
      await this.recomputeRating(tx, r.kitchenId);
    });
    return { ok: true };
  }

  @Public() @Get('kitchens/:id/reviews')
  async kitchenReviews(@Param('id', ParseUUIDPipe) id: string, @Query('cursor') cursor?: string) {
    const rows = await this.prisma.review.findMany({
      where: { kitchenId: id, status: 'VISIBLE' }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 21, ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      include: { customer: { select: { name: true } } },
    });
    return { items: rows.slice(0, 20).map((r) => ({ id: r.id, rating: r.rating, text: r.text, imageUrls: r.imageKeys.map((k) => this.uploads.url(k)), author: r.customer.name, createdAt: r.createdAt, edited: !!r.editedAt })), nextCursor: rows.length > 20 ? rows[19].id : null };
  }

  // ───────── Favorites ─────────
  @Get('favorites')
  async favorites(@CurrentUser() u: AuthUser) {
    const favs = await this.prisma.favorite.findMany({ where: { userId: u.id }, orderBy: { createdAt: 'desc' }, take: 100 });
    const kitchenIds = favs.map((f) => f.kitchenId).filter((x): x is string => !!x);
    const itemIds = favs.map((f) => f.menuItemId).filter((x): x is string => !!x);
    const kitchens = (await this.prisma.kitchen.findMany({ where: { id: { in: kitchenIds }, verification: 'VERIFIED', deletedAt: null }, include: KITCHEN_INCLUDE })) as KitchenFull[];
    const items = await this.prisma.menuItem.findMany({ where: { id: { in: itemIds }, deletedAt: null }, include: { optionGroups: { include: { options: true } } } });
    return { kitchens: await this.presenter.cards(kitchens), items: items.map((i) => this.presenter.menuItemView(i)) };
  }

  @HttpCode(200) @Post('favorites/kitchens/:id')
  async favKitchen(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    if (!(await this.prisma.kitchen.findFirst({ where: { id, verification: 'VERIFIED', deletedAt: null }, select: { id: true } }))) throw new AppError('NOT_FOUND', 'Kitchen not found.');
    await this.prisma.favorite.createMany({ data: [{ userId: u.id, kitchenId: id }], skipDuplicates: true });
    this.analytics.track('favorite_added', u.id, { kind: 'kitchen' });
    return { ok: true };
  }

  @Delete('favorites/kitchens/:id')
  async unfavKitchen(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    await this.prisma.favorite.deleteMany({ where: { userId: u.id, kitchenId: id } });
    return { ok: true };
  }

  @HttpCode(200) @Post('favorites/items/:id')
  async favItem(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    if (!(await this.prisma.menuItem.findFirst({ where: { id, deletedAt: null, kitchen: { verification: 'VERIFIED', deletedAt: null } }, select: { id: true } }))) throw new AppError('NOT_FOUND', 'Item not found.');
    await this.prisma.favorite.createMany({ data: [{ userId: u.id, menuItemId: id }], skipDuplicates: true });
    this.analytics.track('favorite_added', u.id, { kind: 'item' });
    return { ok: true };
  }

  @Delete('favorites/items/:id')
  async unfavItem(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    await this.prisma.favorite.deleteMany({ where: { userId: u.id, menuItemId: id } });
    return { ok: true };
  }

  // ───────── Trust & safety ─────────
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('reports')
  async report(@CurrentUser() u: AuthUser, @Body(z$(reportSchema)) b: z.infer<typeof reportSchema>) {
    const exists = {
      USER: () => this.prisma.user.findUnique({ where: { id: b.targetId }, select: { id: true } }),
      KITCHEN: () => this.prisma.kitchen.findUnique({ where: { id: b.targetId }, select: { id: true } }),
      MENU_ITEM: () => this.prisma.menuItem.findUnique({ where: { id: b.targetId }, select: { id: true } }),
      REVIEW: () => this.prisma.review.findUnique({ where: { id: b.targetId }, select: { id: true } }),
      IMAGE: () => this.prisma.upload.findFirst({ where: { OR: [{ id: b.targetId }] }, select: { id: true } }),
    }[b.targetType];
    if (!(await exists())) throw new AppError('NOT_FOUND', 'Reported item not found.');
    if (b.targetType === 'USER' && b.targetId === u.id) throw new AppError('VALIDATION_FAILED', 'You cannot report yourself.');
    await this.prisma.report.createMany({ data: [{ reporterId: u.id, targetType: b.targetType, targetId: b.targetId, reason: b.reason, details: clean(b.details) }], skipDuplicates: true });
    return { ok: true };
  }

  /** A cook can block a customer from ordering from their kitchens; anyone can block to stop interactions. */
  @HttpCode(200) @Post('me/blocks/:userId')
  async block(@CurrentUser() u: AuthUser, @Param('userId', ParseUUIDPipe) userId: string) {
    if (userId === u.id) throw new AppError('VALIDATION_FAILED', 'You cannot block yourself.');
    if (!(await this.prisma.user.findUnique({ where: { id: userId }, select: { id: true } }))) throw new AppError('NOT_FOUND', 'User not found.');
    await this.prisma.userBlock.createMany({ data: [{ blockerId: u.id, blockedId: userId }], skipDuplicates: true });
    return { ok: true };
  }

  @Delete('me/blocks/:userId')
  async unblock(@CurrentUser() u: AuthUser, @Param('userId', ParseUUIDPipe) userId: string) {
    await this.prisma.userBlock.deleteMany({ where: { blockerId: u.id, blockedId: userId } });
    return { ok: true };
  }

  // ───────── Support ─────────
  @Post('support/tickets')
  async openTicket(@CurrentUser() u: AuthUser, @Body(z$(z.object({ subject: z.string().trim().min(3).max(120), message: z.string().trim().min(1).max(2000), orderId: z.string().uuid().optional() }))) b: { subject: string; message: string; orderId?: string }) {
    if (b.orderId && !(await this.prisma.order.findFirst({ where: { id: b.orderId, OR: [{ customerId: u.id }, { kitchen: { ownerId: u.id } }] }, select: { id: true } }))) throw new AppError('NOT_FOUND', 'Order not found.');
    return this.prisma.supportTicket.create({ data: { userId: u.id, orderId: b.orderId, subject: clean(b.subject)!, messages: { create: { authorId: u.id, body: clean(b.message)! } } } });
  }

  @Get('support/tickets')
  myTickets(@CurrentUser() u: AuthUser) {
    return this.prisma.supportTicket.findMany({ where: { userId: u.id }, orderBy: { updatedAt: 'desc' }, take: 50, include: { messages: { orderBy: { createdAt: 'asc' } } } });
  }

  @Post('support/tickets/:id/messages')
  async reply(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body(z$(z.object({ body: z.string().trim().min(1).max(2000) }))) b: { body: string }) {
    const t = await this.prisma.supportTicket.findFirst({ where: { id, userId: u.id } });
    if (!t) throw new AppError('NOT_FOUND', 'Ticket not found.');
    await this.prisma.$transaction([
      this.prisma.supportMessage.create({ data: { ticketId: id, authorId: u.id, body: clean(b.body)! } }),
      this.prisma.supportTicket.update({ where: { id }, data: { status: 'OPEN' } }),
    ]);
    return { ok: true };
  }

  // ───────── Client analytics (whitelisted names, no PII) ─────────
  @Public() @Throttle({ default: { limit: 60, ttl: 60_000 } }) @HttpCode(202) @Post('analytics/events')
  event(@Req() req: AuthedRequest, @Body(z$(z.object({ name: z.enum(ANALYTICS_EVENTS), props: z.record(z.union([z.string().max(100), z.number(), z.boolean()])).optional() }))) b: { name: string; props?: Record<string, string | number | boolean> }) {
    if (b.props && Object.keys(b.props).length > 10) throw new AppError('VALIDATION_FAILED', 'Too many properties.');
    this.analytics.track(b.name, req.user?.id, b.props);
    return { accepted: true };
  }
}
