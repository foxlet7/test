import { z } from 'zod';

const slot = z
  .object({
    dayOfWeek: z.number().int().min(0).max(6),
    openMinute: z.number().int().min(0).max(1439),
    closeMinute: z.number().int().min(0).max(1439),
  })
  .refine((s) => s.openMinute !== s.closeMinute, 'open and close must differ');

export const kitchenCreateSchema = z.object({
  name: z.string().trim().min(2).max(80),
  nameAr: z.string().trim().max(80).optional(),
  description: z.string().trim().max(1000).optional(),
  descriptionAr: z.string().trim().max(1000).optional(),
  policies: z.string().trim().max(1500).optional(),
  city: z.string().trim().min(1).max(80),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  timezone: z
    .string()
    .refine((tz) => {
      try {
        new Intl.DateTimeFormat('en', { timeZone: tz });
        return true;
      } catch {
        return false;
      }
    }, 'Unknown timezone')
    .default('Asia/Riyadh'),
  prepTimeMin: z.number().int().min(5).max(480).default(30),
  minOrderMinor: z.number().int().min(0).max(10_000_000).default(0),
  pickupEnabled: z.boolean().default(true),
  deliveryEnabled: z.boolean().default(true),
  maxConcurrentOrders: z.number().int().min(1).max(500).nullable().optional(),
  cuisineIds: z.array(z.string().uuid()).max(5).default([]),
  coverKey: z.string().max(200).optional(),
  galleryKeys: z.array(z.string().max(200)).max(10).optional(),
});
export const kitchenUpdateSchema = kitchenCreateSchema.partial();

export const scheduleSchema = z.object({ slots: z.array(slot).max(21) });
export const zonesSchema = z.object({
  zones: z
    .array(
      z.object({
        name: z.string().trim().min(1).max(60),
        maxKm: z.number().min(0.1).max(100),
        feeMinor: z.number().int().min(0).max(1_000_000),
        etaMinutes: z.number().int().min(5).max(240).default(30),
      }),
    )
    .max(5),
});
export const availabilitySchema = z.object({
  acceptingOrders: z.boolean().optional(),
  pausedUntil: z.string().datetime().nullable().optional(),
});

export const optionGroupSchema = z
  .object({
    name: z.string().trim().min(1).max(60),
    nameAr: z.string().trim().max(60).optional(),
    type: z.enum(['VARIATION', 'ADDON']),
    required: z.boolean().default(false),
    minSelect: z.number().int().min(0).max(10).default(0),
    maxSelect: z.number().int().min(1).max(10).default(1),
    options: z
      .array(
        z.object({
          name: z.string().trim().min(1).max(60),
          nameAr: z.string().trim().max(60).optional(),
          priceDeltaMinor: z.number().int().min(-1_000_000).max(1_000_000).default(0),
          isAvailable: z.boolean().default(true),
        }),
      )
      .min(1)
      .max(20),
  })
  .refine((g) => g.minSelect <= g.maxSelect, 'minSelect must be <= maxSelect');

export const menuItemSchema = z.object({
  name: z.string().trim().min(1).max(100),
  nameAr: z.string().trim().max(100).optional(),
  description: z.string().trim().max(800).optional(),
  descriptionAr: z.string().trim().max(800).optional(),
  priceMinor: z.number().int().min(0).max(10_000_000),
  categoryId: z.string().uuid().nullable().optional(),
  imageKeys: z.array(z.string().max(200)).max(6).default([]),
  ingredients: z.array(z.string().trim().max(60)).max(40).default([]),
  allergens: z.array(z.string().trim().max(40)).max(14).default([]),
  prepTimeMin: z.number().int().min(1).max(480).nullable().optional(),
  isAvailable: z.boolean().default(true),
  stock: z.number().int().min(0).max(10_000).nullable().optional(),
  optionGroups: z.array(optionGroupSchema).max(8).optional(),
});
export const menuItemUpdateSchema = menuItemSchema.partial();

export const transitionSchema = z.object({
  to: z.enum([
    'ACCEPTED',
    'REJECTED',
    'PREPARING',
    'READY',
    'OUT_FOR_DELIVERY',
    'DELIVERED',
    'CANCELLED',
  ]),
  reason: z.string().trim().max(300).optional(),
});
