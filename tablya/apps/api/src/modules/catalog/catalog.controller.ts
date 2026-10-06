import { Controller, Get, Param, Query, Req } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Prisma } from '@prisma/client';
import { haversineKm, normalizeSearch } from '@tablya/shared';
import { z } from 'zod';
import { Public } from '../../common/auth';
import { AppError } from '../../common/errors';
import { AuthedRequest } from '../../common/filters';
import { PrismaService } from '../../common/prisma.service';
import { AnalyticsService } from '../../common/analytics.service';
import { z$ } from '../../common/zod.pipe';
import { UploadsService } from '../uploads/uploads.service';
import { KITCHEN_INCLUDE, KitchenFull, KitchenPresenter, PUBLIC_KITCHEN_WHERE } from './kitchen.presenter';

const num = z.coerce.number();
const listSchema = z.object({
  lat: num.min(-90).max(90).optional(),
  lng: num.min(-180).max(180).optional(),
  q: z.string().trim().max(80).optional(),
  cuisine: z.string().max(60).optional(),
  category: z.string().max(60).optional(),
  openNow: z.enum(['true', 'false']).optional(),
  minRating: num.min(0).max(5).optional(),
  maxMinOrder: num.int().min(0).optional(),
  maxDistanceKm: num.min(0).max(200).optional(),
  sort: z.enum(['distance', 'rating', 'prep', 'minOrder', 'relevance']).default('relevance'),
  page: num.int().min(1).max(200).default(1),
  pageSize: num.int().min(1).max(30).default(20),
});
const searchSchema = z.object({ q: z.string().trim().min(1).max(80), lat: num.optional(), lng: num.optional() });

@ApiTags('catalog')
@Public()
@Controller()
export class CatalogController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly presenter: KitchenPresenter,
    private readonly uploads: UploadsService,
    private readonly analytics: AnalyticsService,
  ) {}

  @Get('categories')
  categories() {
    return this.prisma.category.findMany({ where: { active: true }, orderBy: { sortOrder: 'asc' } });
  }

  @Get('cuisines')
  cuisines() {
    return this.prisma.cuisine.findMany({ where: { active: true }, orderBy: { sortOrder: 'asc' } });
  }

  /** Trigram + substring match over normalised (Arabic/English) text; returns ids ranked by score. */
  private async matchIds(table: 'Kitchen' | 'MenuItem', q: string, limit = 300): Promise<Map<string, number>> {
    const nq = normalizeSearch(q);
    const like = `%${nq.replace(/[%_\\]/g, '\\$&')}%`;
    const rows = await this.prisma.$queryRaw<{ id: string; score: number }[]>(
      Prisma.sql`SELECT id::text, GREATEST(word_similarity(${nq}, "searchText"), CASE WHEN "searchText" ILIKE ${like} THEN 1 ELSE 0 END)::float AS score
                 FROM ${Prisma.raw(`"${table}"`)}
                 WHERE "deletedAt" IS NULL AND ("searchText" ILIKE ${like} OR word_similarity(${nq}, "searchText") >= 0.5)
                 ORDER BY score DESC LIMIT ${limit}`,
    );
    return new Map(rows.map((r) => [r.id, r.score]));
  }

  @Get('kitchens')
  async kitchens(@Query(z$(listSchema)) f: z.infer<typeof listSchema>) {
    const where: Prisma.KitchenWhereInput = { ...PUBLIC_KITCHEN_WHERE };
    const scores = new Map<string, number>();
    if (f.q) {
      const kitchenHits = await this.matchIds('Kitchen', f.q);
      const dishHits = await this.matchIds('MenuItem', f.q);
      const dishKitchens = dishHits.size
        ? await this.prisma.menuItem.findMany({ where: { id: { in: [...dishHits.keys()] } }, select: { id: true, kitchenId: true } })
        : [];
      for (const [id, s] of kitchenHits) scores.set(id, s);
      for (const d of dishKitchens) scores.set(d.kitchenId, Math.max(scores.get(d.kitchenId) ?? 0, (dishHits.get(d.id) ?? 0) * 0.9));
      where.id = { in: [...scores.keys()] };
    }
    if (f.cuisine) where.cuisines = { some: { cuisine: { slug: f.cuisine } } };
    if (f.category) where.menuItems = { some: { category: { slug: f.category }, isAvailable: true, deletedAt: null } };
    if (f.minRating != null) where.ratingAvg = { gte: f.minRating };
    if (f.maxMinOrder != null) where.minOrderMinor = { lte: f.maxMinOrder };

    const rows = (await this.prisma.kitchen.findMany({ where, include: KITCHEN_INCLUDE, take: 500 })) as KitchenFull[];
    const from = f.lat != null && f.lng != null ? { lat: f.lat, lng: f.lng } : undefined;
    let cards = await this.presenter.cards(rows, from);
    if (f.maxDistanceKm != null && from) cards = cards.filter((c) => c.distanceKm != null && c.distanceKm <= f.maxDistanceKm!);
    if (f.openNow === 'true') cards = cards.filter((c) => c.availability === 'OPEN');

    const order: Record<string, number> = { OPEN: 0, FULLY_BOOKED: 1, CLOSED: 2, TEMPORARILY_UNAVAILABLE: 3 };
    const sorters: Record<string, (a: any, b: any) => number> = {
      distance: (a, b) => (a.distanceKm ?? 1e9) - (b.distanceKm ?? 1e9),
      rating: (a, b) => b.ratingAvg - a.ratingAvg || b.ratingCount - a.ratingCount,
      prep: (a, b) => a.prepTimeMin - b.prepTimeMin,
      minOrder: (a, b) => a.minOrderMinor - b.minOrderMinor,
      relevance: (a, b) => (scores.get(b.id) ?? 0) - (scores.get(a.id) ?? 0) || order[a.availability] - order[b.availability] || b.ratingAvg - a.ratingAvg,
    };
    cards.sort(sorters[f.sort]);
    const total = cards.length;
    const items = cards.slice((f.page - 1) * f.pageSize, f.page * f.pageSize);
    if (f.q) this.analytics.track('search', null, { q_len: f.q.length, results: total });
    return { items, page: f.page, pageSize: f.pageSize, total };
  }

  @Get('kitchens/:idOrSlug')
  async kitchen(@Param('idOrSlug') idOrSlug: string, @Query('lat') lat?: string, @Query('lng') lng?: string, @Req() req?: AuthedRequest) {
    const isUuid = /^[0-9a-f-]{36}$/i.test(idOrSlug);
    const k = (await this.prisma.kitchen.findFirst({
      where: { ...PUBLIC_KITCHEN_WHERE, ...(isUuid ? { id: idOrSlug } : { slug: idOrSlug }) },
      include: { ...KITCHEN_INCLUDE, owner: { select: { id: true, name: true, cookProfile: true } } },
    })) as (KitchenFull & { owner: { id: string; name: string; cookProfile: { bio: string | null; avatarKey: string | null } | null } }) | null;
    if (!k) throw new AppError('NOT_FOUND', 'Kitchen not found.');
    const counts = await this.presenter.activeCounts([k.id]);
    const from = lat && lng && !isNaN(+lat) && !isNaN(+lng) ? { lat: +lat, lng: +lng } : undefined;
    const items = await this.prisma.menuItem.findMany({
      where: { kitchenId: k.id, deletedAt: null }, include: { optionGroups: { include: { options: true } } }, orderBy: [{ soldCount: 'desc' }, { name: 'asc' }],
    });
    const reviews = await this.prisma.review.findMany({
      where: { kitchenId: k.id, status: 'VISIBLE' }, orderBy: { createdAt: 'desc' }, take: 10,
      include: { customer: { select: { name: true } } },
    });
    this.analytics.track('kitchen_viewed', req?.user?.id, { kitchenId: k.id });
    return {
      ...this.presenter.card(k, counts.get(k.id) ?? 0, from),
      description: k.description, descriptionAr: k.descriptionAr, policies: k.policies,
      galleryUrls: k.galleryKeys.map((g) => this.uploads.url(g)),
      cook: { name: k.owner.name, bio: k.owner.cookProfile?.bio ?? null, avatarUrl: this.uploads.url(k.owner.cookProfile?.avatarKey) },
      location: { lat: Math.round(k.lat * 100) / 100, lng: Math.round(k.lng * 100) / 100 }, // coarse: exact kitchen location is private
      timezone: k.timezone,
      schedule: k.schedule.map((s) => ({ dayOfWeek: s.dayOfWeek, openMinute: s.openMinute, closeMinute: s.closeMinute })),
      zones: k.zones.map((z) => ({ id: z.id, name: z.name, maxKm: z.maxKm, feeMinor: z.feeMinor, etaMinutes: z.etaMinutes })),
      menu: items.map((i) => this.presenter.menuItemView(i)),
      reviews: reviews.map((r) => ({ id: r.id, rating: r.rating, text: r.text, author: r.customer.name, createdAt: r.createdAt })),
    };
  }

  @Get('menu-items/:id')
  async menuItem(@Param('id') id: string, @Req() req: AuthedRequest) {
    if (!/^[0-9a-f-]{36}$/i.test(id)) throw new AppError('NOT_FOUND', 'Item not found.');
    const i = await this.prisma.menuItem.findFirst({
      where: { id, deletedAt: null, kitchen: PUBLIC_KITCHEN_WHERE }, include: { optionGroups: { include: { options: true } } },
    });
    if (!i) throw new AppError('NOT_FOUND', 'Item not found.');
    this.analytics.track('food_viewed', req.user?.id, { itemId: id });
    return this.presenter.menuItemView(i);
  }

  @Get('search')
  async search(@Query(z$(searchSchema)) f: z.infer<typeof searchSchema>) {
    const [kScores, dScores] = await Promise.all([this.matchIds('Kitchen', f.q, 50), this.matchIds('MenuItem', f.q, 50)]);
    const from = f.lat != null && f.lng != null ? { lat: f.lat, lng: f.lng } : undefined;
    const kitchens = (await this.prisma.kitchen.findMany({ where: { ...PUBLIC_KITCHEN_WHERE, id: { in: [...kScores.keys()] } }, include: KITCHEN_INCLUDE })) as KitchenFull[];
    const dishes = await this.prisma.menuItem.findMany({
      where: { id: { in: [...dScores.keys()] }, deletedAt: null, kitchen: PUBLIC_KITCHEN_WHERE },
      include: { optionGroups: { include: { options: true } }, kitchen: { select: { id: true, name: true, nameAr: true } } },
    });
    const cuisines = await this.prisma.cuisine.findMany({ where: { active: true, OR: [{ name: { contains: f.q, mode: 'insensitive' } }, { nameAr: { contains: f.q } }] }, take: 5 });
    this.analytics.track('search', null, { q_len: f.q.length });
    return {
      kitchens: (await this.presenter.cards(kitchens, from)).sort((a, b) => (kScores.get(b.id) ?? 0) - (kScores.get(a.id) ?? 0)),
      dishes: dishes
        .sort((a, b) => (dScores.get(b.id) ?? 0) - (dScores.get(a.id) ?? 0))
        .map((d) => ({ ...this.presenter.menuItemView(d), kitchen: d.kitchen })),
      cuisines,
    };
  }

  @Get('home')
  async home(@Query('lat') lat?: string, @Query('lng') lng?: string) {
    const from = lat && lng && !isNaN(+lat) && !isNaN(+lng) ? { lat: +lat, lng: +lng } : undefined;
    const kitchens = (await this.prisma.kitchen.findMany({ where: PUBLIC_KITCHEN_WHERE, include: KITCHEN_INCLUDE, take: 300 })) as KitchenFull[];
    const cards = await this.presenter.cards(kitchens, from);
    const featured = [...cards].sort((a, b) => b.ratingAvg - a.ratingAvg || b.ratingCount - a.ratingCount).slice(0, 10);
    const nearby = from ? [...cards].filter((c) => c.distanceKm != null && c.distanceKm <= 25).sort((a, b) => a.distanceKm! - b.distanceKm!).slice(0, 10) : [];
    const popular = await this.prisma.menuItem.findMany({
      where: { deletedAt: null, isAvailable: true, kitchen: PUBLIC_KITCHEN_WHERE }, orderBy: { soldCount: 'desc' }, take: 10,
      include: { optionGroups: { include: { options: true } }, kitchen: { select: { id: true, name: true, nameAr: true } } },
    });
    const now = new Date();
    const promotions = await this.prisma.promotion.findMany({
      where: { active: true, AND: [{ OR: [{ startsAt: null }, { startsAt: { lte: now } }] }, { OR: [{ endsAt: null }, { endsAt: { gte: now } }] }] },
      orderBy: { sortOrder: 'asc' }, take: 10, include: { coupon: { select: { code: true } } },
    });
    const categories = await this.prisma.category.findMany({ where: { active: true }, orderBy: { sortOrder: 'asc' } });
    return {
      categories, featured, nearby,
      popular: popular.map((d) => ({ ...this.presenter.menuItemView(d), kitchen: d.kitchen })),
      promotions: promotions.map((p) => ({ id: p.id, title: p.title, titleAr: p.titleAr, imageUrl: this.uploads.url(p.imageKey), couponCode: p.coupon?.code ?? null })),
    };
  }
}
