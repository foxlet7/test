import { Injectable } from '@nestjs/common';
import { Kitchen, KitchenSchedule, DeliveryZone, Cuisine, KitchenCuisine } from '@prisma/client';
import {
  ACTIVE_KITCHEN_STATUSES,
  haversineKm,
  kitchenAvailability,
  KitchenAvailability,
} from '@tablya/shared';
import { PrismaService } from '../../common/prisma.service';
import { UploadsService } from '../uploads/uploads.service';

export type KitchenFull = Kitchen & {
  schedule: KitchenSchedule[];
  zones: DeliveryZone[];
  cuisines: (KitchenCuisine & { cuisine: Cuisine })[];
};

/** Kitchens visible to the public: verified, not deleted. */
export const PUBLIC_KITCHEN_WHERE = {
  verification: 'VERIFIED',
  deletedAt: null,
  owner: { status: 'ACTIVE' },
} as const;

@Injectable()
export class KitchenPresenter {
  constructor(
    private readonly prisma: PrismaService,
    private readonly uploads: UploadsService,
  ) {}

  async activeCounts(ids: string[]): Promise<Map<string, number>> {
    if (!ids.length) return new Map();
    const rows = await this.prisma.order.groupBy({
      by: ['kitchenId'],
      where: { kitchenId: { in: ids }, status: { in: ACTIVE_KITCHEN_STATUSES as any } },
      _count: { _all: true },
    });
    return new Map(rows.map((r) => [r.kitchenId, r._count._all]));
  }

  availabilityOf(k: KitchenFull, activeCount: number, now = new Date()): KitchenAvailability {
    if (k.verification !== 'VERIFIED' || k.deletedAt) return 'TEMPORARILY_UNAVAILABLE';
    return kitchenAvailability({
      slots: k.schedule,
      timezone: k.timezone,
      pausedUntil: k.pausedUntil,
      acceptingOrders: k.acceptingOrders,
      activeOrderCount: activeCount,
      maxConcurrentOrders: k.maxConcurrentOrders,
      now,
    });
  }

  card(k: KitchenFull, activeCount: number, from?: { lat: number; lng: number }) {
    const distanceKm = from ? Math.round(haversineKm(from, k) * 10) / 10 : null;
    const fees = k.zones.map((z) => z.feeMinor);
    return {
      id: k.id,
      slug: k.slug,
      name: k.name,
      nameAr: k.nameAr,
      city: k.city,
      coverUrl: this.uploads.url(k.coverKey),
      cuisines: k.cuisines.map((c) => ({
        id: c.cuisine.id,
        slug: c.cuisine.slug,
        name: c.cuisine.name,
        nameAr: c.cuisine.nameAr,
      })),
      ratingAvg: Math.round(k.ratingAvg * 10) / 10,
      ratingCount: k.ratingCount,
      prepTimeMin: k.prepTimeMin,
      minOrderMinor: k.minOrderMinor,
      deliveryFeeFromMinor: fees.length ? Math.min(...fees) : null,
      deliveryEnabled: k.deliveryEnabled,
      pickupEnabled: k.pickupEnabled,
      distanceKm,
      availability: this.availabilityOf(k, activeCount),
    };
  }

  async cards(kitchens: KitchenFull[], from?: { lat: number; lng: number }) {
    const counts = await this.activeCounts(kitchens.map((k) => k.id));
    return kitchens.map((k) => this.card(k, counts.get(k.id) ?? 0, from));
  }

  menuItemView(i: any) {
    return {
      id: i.id,
      kitchenId: i.kitchenId,
      categoryId: i.categoryId,
      name: i.name,
      nameAr: i.nameAr,
      description: i.description,
      descriptionAr: i.descriptionAr,
      priceMinor: i.priceMinor,
      imageUrls: (i.imageKeys as string[]).map((k) => this.uploads.url(k)),
      ingredients: i.ingredients,
      allergens: i.allergens,
      prepTimeMin: i.prepTimeMin,
      isAvailable: i.isAvailable && (i.stock == null || i.stock > 0),
      stock: i.stock,
      soldCount: i.soldCount,
      optionGroups: (i.optionGroups ?? []).map((g: any) => ({
        id: g.id,
        name: g.name,
        nameAr: g.nameAr,
        type: g.type,
        required: g.required,
        minSelect: g.minSelect,
        maxSelect: g.maxSelect,
        options: g.options.map((o: any) => ({
          id: o.id,
          name: o.name,
          nameAr: o.nameAr,
          priceDeltaMinor: o.priceDeltaMinor,
          isAvailable: o.isAvailable,
        })),
      })),
    };
  }
}

export const KITCHEN_INCLUDE = {
  schedule: true,
  zones: true,
  cuisines: { include: { cuisine: true } },
} as const;
