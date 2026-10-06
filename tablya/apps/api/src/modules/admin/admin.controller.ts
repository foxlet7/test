import { Body, Controller, Get, Headers, HttpCode, Param, ParseUUIDPipe, Patch, Post, Put, Delete, Query, Req, StreamableFile } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Prisma, Role } from '@prisma/client';
import { normalizeSearch } from '@tablya/shared';
import { z } from 'zod';
import { AuditService } from '../../common/audit.service';
import { ADMIN_ROLES, AuthUser, CurrentUser, Roles, STAFF_ROLES } from '../../common/auth';
import { AppError } from '../../common/errors';
import { AuthedRequest } from '../../common/filters';
import { PrismaService } from '../../common/prisma.service';
import { SettingsService } from '../../common/settings.service';
import { z$ } from '../../common/zod.pipe';
import { NotificationsService } from '../notifications/notifications.service';
import { OrderLifecycleService } from '../orders/order-lifecycle.service';
import { LedgerService } from '../payments/ledger.service';
import { PaymentsService } from '../payments/payments.service';
import { StorageProvider } from '../uploads/storage';

const page = z.object({ page: z.coerce.number().int().min(1).max(10_000).default(1), pageSize: z.coerce.number().int().min(1).max(100).default(25), q: z.string().trim().max(80).optional(), status: z.string().max(40).optional() });
const reason = z.object({ reason: z.string().trim().min(3).max(500) });
const paged = <T>(items: T[], total: number, p: { page: number; pageSize: number }) => ({ items, total, page: p.page, pageSize: p.pageSize });

@ApiTags('admin')
@ApiBearerAuth()
@Roles(...STAFF_ROLES)
@Controller('admin')
export class AdminController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly settings: SettingsService,
    private readonly lifecycle: OrderLifecycleService,
    private readonly payments: PaymentsService,
    private readonly ledger: LedgerService,
    private readonly notifications: NotificationsService,
    private readonly storage: StorageProvider,
  ) {}

  private act(u: AuthUser, req: AuthedRequest, action: string, entityType: string, entityId: string | null, meta?: Prisma.InputJsonValue) {
    return this.audit.log({ actorId: u.id, actorRole: u.roles.find((r) => STAFF_ROLES.includes(r)), action, entityType, entityId, meta, ip: req.ip, requestId: req.requestId });
  }

  // ───────── Dashboard & analytics ─────────
  @Roles(...ADMIN_ROLES, 'SUPPORT') @Get('dashboard')
  async dashboard() {
    const since30 = new Date(Date.now() - 30 * 86_400_000);
    const since7 = new Date(Date.now() - 7 * 86_400_000);
    const [users, activeCustomers, kitchens, pendingVerification, orders30, byStatus, revenue, refunds, openReports, openTickets, ratings, failedWebhooks, pendingRefunds] = await Promise.all([
      this.prisma.user.count({ where: { status: 'ACTIVE' } }),
      this.prisma.order.findMany({ where: { createdAt: { gte: since30 }, status: { not: 'PENDING_PAYMENT' } }, distinct: ['customerId'], select: { customerId: true } }),
      this.prisma.kitchen.count({ where: { verification: 'VERIFIED', deletedAt: null } }),
      this.prisma.kitchen.count({ where: { verification: { in: ['SUBMITTED', 'UNDER_REVIEW'] } } }),
      this.prisma.order.count({ where: { createdAt: { gte: since30 }, status: { not: 'PENDING_PAYMENT' } } }),
      this.prisma.order.groupBy({ by: ['status'], _count: { _all: true } }),
      this.prisma.ledgerEntry.aggregate({ where: { account: 'PLATFORM_FEE', createdAt: { gte: since30 } }, _sum: { amountMinor: true } }),
      this.prisma.refund.aggregate({ where: { status: 'SUCCEEDED', createdAt: { gte: since30 } }, _sum: { amountMinor: true }, _count: { _all: true } }),
      this.prisma.report.count({ where: { status: 'OPEN' } }),
      this.prisma.supportTicket.count({ where: { status: { in: ['OPEN', 'PENDING'] } } }),
      this.prisma.review.aggregate({ where: { status: 'VISIBLE' }, _avg: { rating: true }, _count: { _all: true } }),
      this.prisma.webhookEvent.count({ where: { receivedAt: { gte: since7 }, OR: [{ signatureValid: false }, { error: { not: null }, processedAt: null }] } }),
      this.prisma.order.count({ where: { status: 'REFUND_PENDING' } }),
    ]);
    const gmv = await this.prisma.order.aggregate({ where: { createdAt: { gte: since30 }, status: { in: ['PLACED', 'ACCEPTED', 'PREPARING', 'READY', 'OUT_FOR_DELIVERY', 'DELIVERED', 'COMPLETED'] } }, _sum: { totalMinor: true } });
    let db = 'ok';
    try { await this.prisma.$queryRaw`SELECT 1`; } catch { db = 'down'; }
    return {
      users, activeCustomers30d: activeCustomers.length, activeKitchens: kitchens, pendingVerification, orders30d: orders30,
      ordersByStatus: Object.fromEntries(byStatus.map((s) => [s.status, s._count._all])), gmv30dMinor: gmv._sum.totalMinor ?? 0,
      platformRevenue30dMinor: revenue._sum.amountMinor ?? 0, refunds30d: { count: refunds._count._all, amountMinor: refunds._sum.amountMinor ?? 0 },
      openReports, openTickets, rating: { avg: ratings._avg.rating ?? 0, count: ratings._count._all }, pendingRefunds,
      system: { database: db, webhookProblems7d: failedWebhooks },
    };
  }

  @Roles(...ADMIN_ROLES) @Get('analytics/daily')
  async daily(@Query('days') days = '30') {
    const n = Math.min(Math.max(parseInt(days, 10) || 30, 1), 180);
    const rows = await this.prisma.$queryRaw<{ day: Date; orders: bigint; gmv: bigint; events: bigint }[]>`
      SELECT d::date AS day,
        COALESCE((SELECT count(*) FROM "Order" o WHERE o."createdAt"::date = d::date AND o.status <> 'PENDING_PAYMENT'), 0) AS orders,
        COALESCE((SELECT sum(o."totalMinor") FROM "Order" o WHERE o."createdAt"::date = d::date AND o.status IN ('PLACED','ACCEPTED','PREPARING','READY','OUT_FOR_DELIVERY','DELIVERED','COMPLETED')), 0) AS gmv,
        COALESCE((SELECT count(*) FROM "AnalyticsEvent" a WHERE a."createdAt"::date = d::date), 0) AS events
      FROM generate_series(now() - (${n}::int || ' days')::interval, now(), '1 day') d ORDER BY day`;
    const funnel = await this.prisma.analyticsEvent.groupBy({ by: ['name'], where: { createdAt: { gte: new Date(Date.now() - n * 86_400_000) } }, _count: { _all: true } });
    return { daily: rows.map((r) => ({ day: r.day, orders: Number(r.orders), gmvMinor: Number(r.gmv), events: Number(r.events) })), events: Object.fromEntries(funnel.map((f) => [f.name, f._count._all])) };
  }

  // ───────── Users ─────────
  @Get('users')
  async users(@Query(z$(page)) p: z.infer<typeof page>) {
    const where: Prisma.UserWhereInput = { ...(p.status ? { status: p.status as any } : {}), ...(p.q ? { OR: [{ email: { contains: p.q.toLowerCase() } }, { name: { contains: p.q, mode: 'insensitive' } }, { phone: { contains: p.q } }] } : {}) };
    const [items, total] = await Promise.all([
      this.prisma.user.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (p.page - 1) * p.pageSize, take: p.pageSize, select: { id: true, email: true, phone: true, name: true, roles: true, status: true, createdAt: true, lastLoginAt: true } }),
      this.prisma.user.count({ where }),
    ]);
    return paged(items, total, p);
  }

  @Roles(...ADMIN_ROLES) @HttpCode(200) @Post('users/:id/suspend')
  async suspend(@CurrentUser() u: AuthUser, @Req() req: AuthedRequest, @Param('id', ParseUUIDPipe) id: string, @Body(z$(reason)) b: { reason: string }) {
    const t = await this.prisma.user.findUnique({ where: { id } });
    if (!t || t.status === 'DELETED') throw new AppError('NOT_FOUND', 'User not found.');
    if (t.roles.some((r) => STAFF_ROLES.includes(r)) && !u.roles.includes('SUPER_ADMIN')) throw new AppError('FORBIDDEN', 'Only a super admin can suspend staff.');
    if (t.id === u.id) throw new AppError('FORBIDDEN', 'You cannot suspend yourself.');
    await this.prisma.$transaction([
      this.prisma.user.update({ where: { id }, data: { status: 'SUSPENDED' } }),
      this.prisma.refreshToken.updateMany({ where: { userId: id, revokedAt: null }, data: { revokedAt: new Date() } }),
      this.prisma.kitchen.updateMany({ where: { ownerId: id, deletedAt: null }, data: { acceptingOrders: false } }),
    ]);
    await this.act(u, req, 'USER_SUSPENDED', 'User', id, { reason: b.reason });
    return { ok: true };
  }

  @Roles(...ADMIN_ROLES) @HttpCode(200) @Post('users/:id/reinstate')
  async reinstate(@CurrentUser() u: AuthUser, @Req() req: AuthedRequest, @Param('id', ParseUUIDPipe) id: string, @Body(z$(reason)) b: { reason: string }) {
    const r = await this.prisma.user.updateMany({ where: { id, status: 'SUSPENDED' }, data: { status: 'ACTIVE' } });
    if (!r.count) throw new AppError('NOT_FOUND', 'No suspended user with that id.');
    await this.act(u, req, 'USER_REINSTATED', 'User', id, { reason: b.reason });
    return { ok: true };
  }

  @Roles('SUPER_ADMIN') @HttpCode(200) @Put('users/:id/roles')
  async setRoles(@CurrentUser() u: AuthUser, @Req() req: AuthedRequest, @Param('id', ParseUUIDPipe) id: string, @Body(z$(z.object({ roles: z.array(z.enum(['CUSTOMER', 'COOK', 'KITCHEN_MANAGER', 'SUPPORT', 'MODERATOR', 'ADMIN', 'SUPER_ADMIN'])).min(1), reason: z.string().min(3).max(500) }))) b: { roles: Role[]; reason: string }) {
    if (id === u.id) throw new AppError('FORBIDDEN', 'You cannot change your own roles.');
    const t = await this.prisma.user.findFirst({ where: { id, status: { not: 'DELETED' } } });
    if (!t) throw new AppError('NOT_FOUND', 'User not found.');
    await this.prisma.$transaction([
      this.prisma.user.update({ where: { id }, data: { roles: [...new Set(b.roles)] } }),
      this.prisma.refreshToken.updateMany({ where: { userId: id, revokedAt: null }, data: { revokedAt: new Date() } }), // force re-login with new claims
    ]);
    await this.act(u, req, 'ROLES_CHANGED', 'User', id, { from: t.roles, to: b.roles, reason: b.reason });
    return { ok: true };
  }

  // ───────── Kitchens & verification ─────────
  @Get('kitchens')
  async kitchens(@Query(z$(page)) p: z.infer<typeof page>) {
    const where: Prisma.KitchenWhereInput = { ...(p.status ? { verification: p.status as any } : {}), ...(p.q ? { searchText: { contains: normalizeSearch(p.q) } } : {}) };
    const [items, total] = await Promise.all([
      this.prisma.kitchen.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (p.page - 1) * p.pageSize, take: p.pageSize, include: { owner: { select: { id: true, name: true, email: true } } } }),
      this.prisma.kitchen.count({ where }),
    ]);
    return paged(items, total, p);
  }

  @Get('kitchens/:id')
  async kitchen(@Param('id', ParseUUIDPipe) id: string) {
    const k = await this.prisma.kitchen.findUnique({ where: { id }, include: { owner: { select: { id: true, name: true, email: true, phone: true } }, verifications: { orderBy: { createdAt: 'desc' }, include: { documents: { select: { id: true, type: true, createdAt: true } } } }, zones: true, schedule: true } });
    if (!k) throw new AppError('NOT_FOUND', 'Kitchen not found.');
    return k;
  }

  /** Streams a private verification document. Every access is audit-logged. */
  @Roles(...ADMIN_ROLES) @Get('documents/:id')
  async document(@CurrentUser() u: AuthUser, @Req() req: AuthedRequest, @Param('id', ParseUUIDPipe) id: string) {
    const d = await this.prisma.kitchenDocument.findUnique({ where: { id } });
    if (!d) throw new AppError('NOT_FOUND', 'Document not found.');
    await this.act(u, req, 'DOCUMENT_VIEWED', 'KitchenDocument', id);
    return new StreamableFile(await this.storage.get(d.storageKey, true), { type: 'image/webp', disposition: 'inline' });
  }

  @Roles(...ADMIN_ROLES) @HttpCode(200) @Post('kitchens/:id/review')
  async reviewKitchen(@CurrentUser() u: AuthUser, @Req() req: AuthedRequest, @Param('id', ParseUUIDPipe) id: string, @Body(z$(z.object({ decision: z.enum(['start_review', 'approve', 'reject', 'suspend', 'reinstate']), reason: z.string().trim().max(500).optional() }))) b: { decision: string; reason?: string }) {
    const k = await this.prisma.kitchen.findUnique({ where: { id } });
    if (!k) throw new AppError('NOT_FOUND', 'Kitchen not found.');
    const next = ({ start_review: ['SUBMITTED', 'UNDER_REVIEW'], approve: ['UNDER_REVIEW', 'VERIFIED'], reject: ['UNDER_REVIEW', 'REJECTED'], suspend: ['VERIFIED', 'SUSPENDED'], reinstate: ['SUSPENDED', 'VERIFIED'] } as Record<string, [string, string]>)[b.decision];
    if (k.verification !== next[0]) throw new AppError('ILLEGAL_TRANSITION', `Kitchen is ${k.verification}; cannot ${b.decision}.`);
    if (['reject', 'suspend'].includes(b.decision) && !b.reason) throw new AppError('VALIDATION_FAILED', 'A reason is required.');
    await this.prisma.$transaction(async (tx) => {
      await tx.kitchen.update({ where: { id }, data: { verification: next[1] as any } });
      const v = await tx.kitchenVerification.findFirst({ where: { kitchenId: id }, orderBy: { createdAt: 'desc' } });
      if (v && ['start_review', 'approve', 'reject'].includes(b.decision)) await tx.kitchenVerification.update({ where: { id: v.id }, data: { status: next[1] as any, note: b.reason, reviewerId: u.id, reviewedAt: new Date() } });
    });
    await this.act(u, req, `KITCHEN_${b.decision.toUpperCase()}`, 'Kitchen', id, { reason: b.reason ?? null });
    if (['approve', 'reject'].includes(b.decision)) await this.notifications.notify(k.ownerId, 'verification', b.decision === 'approve' ? 'notif.order.ACCEPTED.title' : 'notif.order.REJECTED.title', {}, { kitchenId: id });
    return { verification: next[1] };
  }

  // ───────── Orders, payments, refunds ─────────
  @Get('orders')
  async orders(@Query(z$(page.extend({ kitchenId: z.string().uuid().optional() }))) p: z.infer<typeof page> & { kitchenId?: string }) {
    const n = p.q && /^\d+$/.test(p.q) ? parseInt(p.q, 10) : undefined;
    const where: Prisma.OrderWhereInput = { ...(p.status ? { status: p.status as any } : {}), ...(p.kitchenId ? { kitchenId: p.kitchenId } : {}), ...(n ? { orderNo: n } : {}) };
    const [items, total] = await Promise.all([
      this.prisma.order.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (p.page - 1) * p.pageSize, take: p.pageSize, include: { kitchen: { select: { name: true } }, customer: { select: { name: true } } } }),
      this.prisma.order.count({ where }),
    ]);
    return paged(items.map((o) => ({ id: o.id, orderNo: o.orderNo, status: o.status, totalMinor: o.totalMinor, currency: o.currency, paymentMethod: o.paymentMethod, createdAt: o.createdAt, kitchen: o.kitchen.name, customer: o.customer.name })), total, p);
  }

  @Get('orders/:id')
  async order(@Param('id', ParseUUIDPipe) id: string) {
    const o = await this.prisma.order.findUnique({ where: { id }, include: { items: true, history: { orderBy: { createdAt: 'asc' } }, payments: { include: { transactions: true } }, refunds: true, ledger: true, customer: { select: { id: true, name: true, email: true } }, kitchen: { select: { id: true, name: true } } } });
    if (!o) throw new AppError('NOT_FOUND', 'Order not found.');
    return o;
  }

  @Roles(...ADMIN_ROLES, 'SUPPORT') @HttpCode(200) @Post('orders/:id/transition')
  async orderTransition(@CurrentUser() u: AuthUser, @Req() req: AuthedRequest, @Param('id', ParseUUIDPipe) id: string, @Body(z$(z.object({ to: z.enum(['ACCEPTED', 'REJECTED', 'PREPARING', 'READY', 'OUT_FOR_DELIVERY', 'DELIVERED', 'COMPLETED', 'CANCELLED']), reason: z.string().trim().min(3).max(300) }))) b: { to: any; reason: string }) {
    await this.lifecycle.transition(id, b.to, { type: 'ADMIN', id: u.id }, b.reason);
    await this.act(u, req, 'ORDER_STATUS_OVERRIDE', 'Order', id, { to: b.to, reason: b.reason });
    return this.order(id);
  }

  @Roles(...ADMIN_ROLES) @HttpCode(200) @Post('orders/:id/refund')
  async refund(@CurrentUser() u: AuthUser, @Req() req: AuthedRequest, @Headers('idempotency-key') key: string | undefined, @Param('id', ParseUUIDPipe) id: string, @Body(z$(z.object({ amountMinor: z.number().int().positive().optional(), reason: z.string().trim().min(3).max(300), platformFunded: z.boolean().default(false) }))) b: { amountMinor?: number; reason: string; platformFunded: boolean }) {
    if (!key || !/^[\w-]{16,80}$/.test(key)) throw new AppError('VALIDATION_FAILED', 'A valid Idempotency-Key header is required.');
    const r = await this.payments.refundOrder(id, { actor: { type: 'ADMIN', id: u.id }, reason: b.reason, idempotencyKey: `admin:${key}`, amountMinor: b.amountMinor, platformFunded: b.platformFunded });
    await this.act(u, req, 'REFUND_REQUESTED', 'Order', id, { refundId: r.id, amountMinor: r.amountMinor });
    return r;
  }

  @Roles(...ADMIN_ROLES) @Get('payments')
  async paymentsList(@Query(z$(page)) p: z.infer<typeof page>) {
    const where: Prisma.PaymentWhereInput = p.status ? { status: p.status as any } : {};
    const [items, total] = await Promise.all([this.prisma.payment.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (p.page - 1) * p.pageSize, take: p.pageSize, include: { order: { select: { orderNo: true } } } }), this.prisma.payment.count({ where })]);
    return paged(items, total, p);
  }

  @Roles(...ADMIN_ROLES) @Get('refunds')
  async refundsList(@Query(z$(page)) p: z.infer<typeof page>) {
    const where: Prisma.RefundWhereInput = p.status ? { status: p.status as any } : {};
    const [items, total] = await Promise.all([this.prisma.refund.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (p.page - 1) * p.pageSize, take: p.pageSize }), this.prisma.refund.count({ where })]);
    return paged(items, total, p);
  }

  /** Reconciliation view: gateway events that failed signature or processing. */
  @Roles(...ADMIN_ROLES) @Get('webhooks')
  async webhooks(@Query('problemsOnly') problemsOnly?: string) {
    return this.prisma.webhookEvent.findMany({ where: problemsOnly === 'true' ? { OR: [{ signatureValid: false }, { processedAt: null }] } : {}, orderBy: { receivedAt: 'desc' }, take: 100 });
  }

  // ───────── Payouts ─────────
  @Roles(...ADMIN_ROLES) @Get('kitchens/:id/balance')
  balance(@Param('id', ParseUUIDPipe) id: string) {
    return this.ledger.kitchenBalance(id);
  }

  @Roles(...ADMIN_ROLES) @HttpCode(200) @Post('kitchens/:id/payouts')
  async createPayout(@CurrentUser() u: AuthUser, @Req() req: AuthedRequest, @Headers('idempotency-key') key: string | undefined, @Param('id', ParseUUIDPipe) id: string) {
    if (!key || !/^[\w-]{16,80}$/.test(key)) throw new AppError('VALIDATION_FAILED', 'A valid Idempotency-Key header is required.');
    const existing = await this.prisma.payout.findUnique({ where: { idempotencyKey: `${id}:${key}` } });
    if (existing) return existing;
    const settings = await this.settings.get();
    const payout = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Kitchen" WHERE id = ${id}::uuid FOR UPDATE`; // serialise payouts per kitchen
      const bal = await this.ledger.kitchenBalance(id);
      if (bal.availableMinor <= 0) throw new AppError('CONFLICT', 'Nothing to pay out.');
      return tx.payout.create({ data: { kitchenId: id, amountMinor: bal.availableMinor, currency: settings.currency, periodStart: new Date(0), periodEnd: new Date(), idempotencyKey: `${id}:${key}` } });
    });
    await this.act(u, req, 'PAYOUT_CREATED', 'Payout', payout.id, { amountMinor: payout.amountMinor });
    return payout;
  }

  @Roles(...ADMIN_ROLES) @HttpCode(200) @Post('payouts/:id/mark-paid')
  async markPaid(@CurrentUser() u: AuthUser, @Req() req: AuthedRequest, @Param('id', ParseUUIDPipe) id: string, @Body(z$(z.object({ providerRef: z.string().trim().min(1).max(100) }))) b: { providerRef: string }) {
    const r = await this.prisma.payout.updateMany({ where: { id, status: { in: ['PENDING', 'PROCESSING'] } }, data: { status: 'PAID', providerRef: b.providerRef } });
    if (!r.count) throw new AppError('CONFLICT', 'Payout is not pending.');
    await this.act(u, req, 'PAYOUT_PAID', 'Payout', id, { providerRef: b.providerRef });
    return { ok: true };
  }

  // ───────── Reviews & moderation ─────────
  @Roles(...ADMIN_ROLES, 'MODERATOR') @Get('reviews')
  async reviews(@Query(z$(page)) p: z.infer<typeof page>) {
    const where: Prisma.ReviewWhereInput = p.status ? { status: p.status as any } : {};
    const [items, total] = await Promise.all([this.prisma.review.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (p.page - 1) * p.pageSize, take: p.pageSize, include: { customer: { select: { name: true } }, kitchen: { select: { name: true } } } }), this.prisma.review.count({ where })]);
    return paged(items, total, p);
  }

  @Roles(...ADMIN_ROLES, 'MODERATOR') @HttpCode(200) @Post('reviews/:id/visibility')
  async reviewVisibility(@CurrentUser() u: AuthUser, @Req() req: AuthedRequest, @Param('id', ParseUUIDPipe) id: string, @Body(z$(z.object({ visible: z.boolean(), reason: z.string().trim().min(3).max(300) }))) b: { visible: boolean; reason: string }) {
    const r = await this.prisma.review.findUnique({ where: { id } });
    if (!r) throw new AppError('NOT_FOUND', 'Review not found.');
    await this.prisma.$transaction(async (tx) => {
      await tx.review.update({ where: { id }, data: { status: b.visible ? 'VISIBLE' : 'HIDDEN' } });
      const a = await tx.review.aggregate({ where: { kitchenId: r.kitchenId, status: 'VISIBLE' }, _avg: { rating: true }, _count: { _all: true } });
      await tx.kitchen.update({ where: { id: r.kitchenId }, data: { ratingAvg: a._avg.rating ?? 0, ratingCount: a._count._all } });
      await tx.moderationAction.create({ data: { actorId: u.id, targetType: 'REVIEW', targetId: id, action: b.visible ? 'UNHIDE' : 'HIDE', reason: b.reason } });
    });
    await this.act(u, req, b.visible ? 'REVIEW_UNHIDDEN' : 'REVIEW_HIDDEN', 'Review', id, { reason: b.reason });
    return { ok: true };
  }

  @Roles(...ADMIN_ROLES, 'MODERATOR') @Get('reports')
  async reports(@Query(z$(page)) p: z.infer<typeof page>) {
    const where: Prisma.ReportWhereInput = { status: (p.status as any) ?? 'OPEN' };
    const [items, total] = await Promise.all([this.prisma.report.findMany({ where, orderBy: { createdAt: 'asc' }, skip: (p.page - 1) * p.pageSize, take: p.pageSize, include: { reporter: { select: { name: true } } } }), this.prisma.report.count({ where })]);
    return paged(items, total, p);
  }

  /** Resolve a report and apply the chosen moderation action atomically; everything lands in ModerationAction + AuditLog. */
  @Roles(...ADMIN_ROLES, 'MODERATOR') @HttpCode(200) @Post('reports/:id/resolve')
  async resolveReport(@CurrentUser() u: AuthUser, @Req() req: AuthedRequest, @Param('id', ParseUUIDPipe) id: string, @Body(z$(z.object({ action: z.enum(['DISMISS', 'HIDE_REVIEW', 'HIDE_ITEM', 'SUSPEND_KITCHEN', 'SUSPEND_USER']), reason: z.string().trim().min(3).max(500) }))) b: { action: string; reason: string }) {
    const rep = await this.prisma.report.findUnique({ where: { id } });
    if (!rep || rep.status !== 'OPEN') throw new AppError('NOT_FOUND', 'Open report not found.');
    if (b.action === 'SUSPEND_USER' && !u.roles.some((r) => ADMIN_ROLES.includes(r))) throw new AppError('FORBIDDEN', 'Only admins can suspend users.');
    await this.prisma.$transaction(async (tx) => {
      if (b.action === 'HIDE_REVIEW' && rep.targetType === 'REVIEW') {
        const r = await tx.review.update({ where: { id: rep.targetId }, data: { status: 'HIDDEN' } });
        const a = await tx.review.aggregate({ where: { kitchenId: r.kitchenId, status: 'VISIBLE' }, _avg: { rating: true }, _count: { _all: true } });
        await tx.kitchen.update({ where: { id: r.kitchenId }, data: { ratingAvg: a._avg.rating ?? 0, ratingCount: a._count._all } });
      } else if (b.action === 'HIDE_ITEM' && rep.targetType === 'MENU_ITEM') await tx.menuItem.update({ where: { id: rep.targetId }, data: { isAvailable: false } });
      else if (b.action === 'SUSPEND_KITCHEN' && rep.targetType === 'KITCHEN') await tx.kitchen.update({ where: { id: rep.targetId }, data: { verification: 'SUSPENDED' } });
      else if (b.action === 'SUSPEND_USER' && rep.targetType === 'USER') {
        await tx.user.update({ where: { id: rep.targetId }, data: { status: 'SUSPENDED' } });
        await tx.refreshToken.updateMany({ where: { userId: rep.targetId, revokedAt: null }, data: { revokedAt: new Date() } });
      } else if (b.action !== 'DISMISS') throw new AppError('VALIDATION_FAILED', 'That action does not apply to this report target.');
      await tx.report.update({ where: { id }, data: { status: b.action === 'DISMISS' ? 'DISMISSED' : 'ACTIONED' } });
      await tx.moderationAction.create({ data: { reportId: id, actorId: u.id, targetType: rep.targetType, targetId: rep.targetId, action: b.action, reason: b.reason } });
    });
    await this.act(u, req, `MODERATION_${b.action}`, rep.targetType, rep.targetId, { reportId: id, reason: b.reason });
    return { ok: true };
  }

  // ───────── Catalogue / marketing ─────────
  @Roles(...ADMIN_ROLES) @Get('coupons')
  coupons() { return this.prisma.coupon.findMany({ orderBy: { createdAt: 'desc' }, take: 200 }); }

  @Roles(...ADMIN_ROLES) @Post('coupons')
  async createCoupon(@CurrentUser() u: AuthUser, @Req() req: AuthedRequest, @Body(z$(z.object({ code: z.string().trim().toUpperCase().regex(/^[A-Z0-9_-]{3,30}$/), type: z.enum(['PERCENT', 'FIXED']), value: z.number().int().positive().max(10_000_000), maxDiscountMinor: z.number().int().positive().nullable().optional(), minSubtotalMinor: z.number().int().min(0).default(0), startsAt: z.string().datetime().optional(), endsAt: z.string().datetime().optional(), usageLimit: z.number().int().positive().nullable().optional(), perUserLimit: z.number().int().positive().default(1), kitchenId: z.string().uuid().nullable().optional() }).refine((c) => c.type !== 'PERCENT' || c.value <= 100, 'Percent coupons max 100'))) b: any) {
    const c = await this.prisma.coupon.create({ data: { ...b, startsAt: b.startsAt ? new Date(b.startsAt) : undefined, endsAt: b.endsAt ? new Date(b.endsAt) : undefined } });
    await this.act(u, req, 'COUPON_CREATED', 'Coupon', c.id, { code: c.code });
    return c;
  }

  @Roles(...ADMIN_ROLES) @Patch('coupons/:id')
  async toggleCoupon(@CurrentUser() u: AuthUser, @Req() req: AuthedRequest, @Param('id', ParseUUIDPipe) id: string, @Body(z$(z.object({ active: z.boolean() }))) b: { active: boolean }) {
    const c = await this.prisma.coupon.update({ where: { id }, data: { active: b.active } });
    await this.act(u, req, 'COUPON_TOGGLED', 'Coupon', id, { active: b.active });
    return c;
  }

  @Roles(...ADMIN_ROLES) @Post('categories')
  async createCategory(@CurrentUser() u: AuthUser, @Req() req: AuthedRequest, @Body(z$(z.object({ slug: z.string().regex(/^[a-z0-9-]{2,40}$/), name: z.string().trim().min(1).max(60), nameAr: z.string().trim().min(1).max(60), sortOrder: z.number().int().default(0) }))) b: any) {
    const c = await this.prisma.category.create({ data: b });
    await this.act(u, req, 'CATEGORY_CREATED', 'Category', c.id);
    return c;
  }

  @Roles(...ADMIN_ROLES) @Patch('categories/:id')
  async updateCategory(@CurrentUser() u: AuthUser, @Req() req: AuthedRequest, @Param('id', ParseUUIDPipe) id: string, @Body(z$(z.object({ name: z.string().trim().min(1).max(60).optional(), nameAr: z.string().trim().min(1).max(60).optional(), sortOrder: z.number().int().optional(), active: z.boolean().optional() }))) b: any) {
    const c = await this.prisma.category.update({ where: { id }, data: b });
    await this.act(u, req, 'CATEGORY_UPDATED', 'Category', id, b);
    return c;
  }

  @Roles(...ADMIN_ROLES) @Post('cuisines')
  async createCuisine(@CurrentUser() u: AuthUser, @Req() req: AuthedRequest, @Body(z$(z.object({ slug: z.string().regex(/^[a-z0-9-]{2,40}$/), name: z.string().trim().min(1).max(60), nameAr: z.string().trim().min(1).max(60), sortOrder: z.number().int().default(0) }))) b: any) {
    const c = await this.prisma.cuisine.create({ data: b });
    await this.act(u, req, 'CUISINE_CREATED', 'Cuisine', c.id);
    return c;
  }

  @Roles(...ADMIN_ROLES) @Post('promotions')
  async createPromotion(@CurrentUser() u: AuthUser, @Req() req: AuthedRequest, @Body(z$(z.object({ title: z.string().trim().min(1).max(80), titleAr: z.string().trim().min(1).max(80), couponId: z.string().uuid().nullable().optional(), startsAt: z.string().datetime().optional(), endsAt: z.string().datetime().optional(), sortOrder: z.number().int().default(0) }))) b: any) {
    const p = await this.prisma.promotion.create({ data: { ...b, startsAt: b.startsAt ? new Date(b.startsAt) : undefined, endsAt: b.endsAt ? new Date(b.endsAt) : undefined } });
    await this.act(u, req, 'PROMOTION_CREATED', 'Promotion', p.id);
    return p;
  }

  @Roles(...ADMIN_ROLES) @Delete('promotions/:id')
  async deletePromotion(@CurrentUser() u: AuthUser, @Req() req: AuthedRequest, @Param('id', ParseUUIDPipe) id: string) {
    await this.prisma.promotion.update({ where: { id }, data: { active: false } });
    await this.act(u, req, 'PROMOTION_DEACTIVATED', 'Promotion', id);
    return { ok: true };
  }

  // ───────── Settings, audit, support, broadcast ─────────
  @Roles(...ADMIN_ROLES) @Get('settings')
  getSettings() { return this.settings.get(); }

  @Roles('SUPER_ADMIN') @Put('settings')
  async putSettings(@CurrentUser() u: AuthUser, @Req() req: AuthedRequest, @Body(z$(z.object({ taxBps: z.number().int().min(0).max(5000).optional(), serviceFeeBps: z.number().int().min(0).max(5000).optional(), defaultCommissionBps: z.number().int().min(0).max(5000).optional(), reason: z.string().trim().min(3).max(300) }))) b: { taxBps?: number; serviceFeeBps?: number; defaultCommissionBps?: number; reason: string }) {
    const before = await this.settings.get();
    for (const k of ['taxBps', 'serviceFeeBps', 'defaultCommissionBps'] as const) if (b[k] !== undefined) await this.settings.set(k, b[k]!);
    await this.act(u, req, 'SETTINGS_CHANGED', 'Setting', null, { before: { ...before }, change: { ...b } });
    return this.settings.get();
  }

  @Roles(...ADMIN_ROLES) @Get('audit-logs')
  async auditLogs(@Query(z$(page.extend({ action: z.string().max(60).optional(), entityType: z.string().max(40).optional(), actorId: z.string().uuid().optional() }))) p: any) {
    const where: Prisma.AuditLogWhereInput = { ...(p.action ? { action: p.action } : {}), ...(p.entityType ? { entityType: p.entityType } : {}), ...(p.actorId ? { actorId: p.actorId } : {}) };
    const [items, total] = await Promise.all([this.prisma.auditLog.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (p.page - 1) * p.pageSize, take: p.pageSize }), this.prisma.auditLog.count({ where })]);
    return paged(items, total, p);
  }

  @Get('support/tickets')
  async tickets(@Query(z$(page)) p: z.infer<typeof page>) {
    const where: Prisma.SupportTicketWhereInput = p.status ? { status: p.status as any } : {};
    const [items, total] = await Promise.all([this.prisma.supportTicket.findMany({ where, orderBy: { updatedAt: 'desc' }, skip: (p.page - 1) * p.pageSize, take: p.pageSize, include: { messages: { orderBy: { createdAt: 'asc' } }, user: { select: { name: true } } } }), this.prisma.supportTicket.count({ where })]);
    return paged(items, total, p);
  }

  @HttpCode(200) @Post('support/tickets/:id/reply')
  async ticketReply(@CurrentUser() u: AuthUser, @Req() req: AuthedRequest, @Param('id', ParseUUIDPipe) id: string, @Body(z$(z.object({ body: z.string().trim().min(1).max(2000), status: z.enum(['PENDING', 'RESOLVED', 'CLOSED']).default('PENDING') }))) b: { body: string; status: any }) {
    const t = await this.prisma.supportTicket.findUnique({ where: { id } });
    if (!t) throw new AppError('NOT_FOUND', 'Ticket not found.');
    await this.prisma.$transaction([this.prisma.supportMessage.create({ data: { ticketId: id, authorId: u.id, body: b.body } }), this.prisma.supportTicket.update({ where: { id }, data: { status: b.status } })]);
    await this.act(u, req, 'TICKET_REPLIED', 'SupportTicket', id);
    return { ok: true };
  }

  /** Marketing broadcast: only users who opted in to marketing messages receive it. */
  @Roles(...ADMIN_ROLES) @HttpCode(200) @Post('notifications/broadcast')
  async broadcast(@CurrentUser() u: AuthUser, @Req() req: AuthedRequest, @Body(z$(z.object({ title: z.string().trim().min(3).max(100), body: z.string().trim().max(300).optional() }))) b: { title: string; body?: string }) {
    const recipients = await this.prisma.user.findMany({ where: { status: 'ACTIVE', notificationPref: { marketing: true } }, select: { id: true } });
    await this.prisma.notification.createMany({ data: recipients.map((r) => ({ userId: r.id, type: 'marketing', titleKey: 'custom', title: b.title, body: b.body })) });
    await this.act(u, req, 'BROADCAST_SENT', 'Notification', null, { recipients: recipients.length, title: b.title });
    return { recipients: recipients.length };
  }
}
