import { z } from 'zod';

export const couponSchema = z.object({
  code: z.string().min(1).toUpperCase(),
  discountType: z.enum(['PERCENT', 'FLAT']),
  discountValue: z.number().positive(),
  // Nullable as well as optional: on an edit, omitting a field means "leave it
  // alone" while null means "clear it". Without null these three could be set
  // but never unset — a coupon given a BDM or an expiry was stuck with it.
  bdmName: z.string().nullish(),
  expiresAt: z.coerce.date().nullish(),
  usageLimit: z.number().int().positive().nullish(),
  active: z.boolean().optional(),
});

export const couponIdParamSchema = z.object({
  id: z.string().min(1),
});

export const listCouponsQuerySchema = z.object({
  active: z.enum(['true', 'false']).optional(),
  search: z.string().max(200).optional(),
});
