import { z } from 'zod';

export const passwordSchema = z
  .string()
  .min(10, 'Password must be at least 10 characters')
  .max(128)
  .refine((p) => /[a-z]/i.test(p) && /\d/.test(p), 'Password must contain letters and digits');

export const phoneSchema = z
  .string()
  .regex(/^\+[1-9]\d{7,14}$/, 'Use E.164 format, e.g. +9665XXXXXXXX');

export const registerSchema = z.object({
  email: z
    .string()
    .email()
    .max(254)
    .transform((e) => e.toLowerCase()),
  password: passwordSchema,
  name: z.string().trim().min(1).max(80),
  phone: phoneSchema.optional(),
  role: z.enum(['CUSTOMER', 'COOK']).default('CUSTOMER'),
  locale: z.enum(['en', 'ar']).default('en'),
});
export type RegisterInput = z.infer<typeof registerSchema>;

export const loginSchema = z.object({
  email: z
    .string()
    .email()
    .transform((e) => e.toLowerCase()),
  password: z.string().min(1).max(128),
  totp: z
    .string()
    .regex(/^\d{6}$/)
    .optional(),
});

export const addressSchema = z.object({
  label: z.string().trim().max(40).optional(),
  line1: z.string().trim().min(1).max(200),
  line2: z.string().trim().max(200).optional(),
  city: z.string().trim().min(1).max(80),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  notes: z.string().trim().max(300).optional(),
  isDefault: z.boolean().optional(),
});

export const cartItemSchema = z.object({
  menuItemId: z.string().uuid(),
  quantity: z.number().int().min(1).max(50),
  optionIds: z.array(z.string().uuid()).max(30).default([]),
  note: z.string().trim().max(300).optional(),
});

export const checkoutSchema = z.object({
  addressId: z.string().uuid().optional(),
  fulfillment: z.enum(['DELIVERY', 'PICKUP']),
  paymentMethod: z.enum(['CARD', 'CASH_ON_DELIVERY']),
  couponCode: z.string().trim().max(40).optional(),
  /** Total the customer saw; the server rejects with PRICE_CHANGED if it differs. */
  expectedTotal: z.number().int().nonnegative(),
  note: z.string().trim().max(300).optional(),
});

export const reviewSchema = z.object({
  orderId: z.string().uuid(),
  rating: z.number().int().min(1).max(5),
  text: z.string().trim().max(1500).optional(),
  imageKeys: z.array(z.string().max(200)).max(4).default([]),
});

export const reportSchema = z.object({
  targetType: z.enum(['USER', 'KITCHEN', 'MENU_ITEM', 'REVIEW', 'IMAGE']),
  targetId: z.string().uuid(),
  reason: z.enum(['SPAM', 'ABUSE', 'UNSAFE_FOOD', 'FRAUD', 'INAPPROPRIATE', 'OTHER']),
  details: z.string().trim().max(1000).optional(),
});
