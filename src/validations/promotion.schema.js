import { z } from 'zod';

export const promotionSchema = z.object({
  name: z.string().trim().min(2, 'Promotion name must be at least 2 characters'),
  description: z.string().trim().nullish(),
  badgeText: z.string().trim().max(100).nullish(),
  code: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9_-]+$/, 'Promo code must be alphanumeric with optional dashes or underscores')
    .toUpperCase()
    .nullish(),
  paidMonths: z.coerce.number().int().min(1, 'Paid duration must be at least 1 month').default(12),
  freeMonths: z.coerce.number().int().min(1, 'Free duration must be at least 1 month').default(2),
  minSeats: z.coerce.number().int().min(1, 'Minimum seats must be at least 1').default(1),
  priority: z.coerce.number().int().min(0).default(0),
  allowCoupons: z.boolean().default(true),
  allowNoCoupon: z.boolean().default(false),
  couponIds: z.array(z.string()).default([]),
  active: z.boolean().default(true),
  isArchived: z.boolean().default(false),
  startsAt: z.coerce.date().default(() => new Date()),
  expiresAt: z.coerce.date().nullish(),
  applyToAllPackages: z.boolean().default(true),
  packageIds: z.array(z.string()).default([]),
  eligibility: z.enum(['ALL', 'NEW_REGISTRATIONS', 'RENEWALS']).default('ALL'),
  usageLimit: z.coerce.number().int().min(1).nullish(),
});

export const promotionUpdateSchema = promotionSchema.partial();

export const promotionIdParamSchema = z.object({
  id: z.string().trim().min(1, 'Promotion ID is required'),
});

export const eligiblePromotionQuerySchema = z.object({
  packageId: z.string().nullish(),
  termMonths: z.coerce.number().int().min(1).default(12),
  seatCount: z.coerce.number().int().min(1).nullish(),
  context: z.enum(['ALL', 'NEW_REGISTRATIONS', 'RENEWALS']).default('ALL'),
  code: z.string().trim().nullish(),
  couponCode: z.string().trim().nullish(),
  couponId: z.string().trim().nullish(),
  promotionId: z.string().trim().nullish(),
});

