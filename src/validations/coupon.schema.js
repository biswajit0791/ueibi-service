import { z } from 'zod';

export const couponSchema = z.object({
  code: z.string().min(1).toUpperCase(),
  discountType: z.enum(['PERCENT', 'FLAT']),
  discountValue: z.number().positive(),
  bdmName: z.string().optional(),
  expiresAt: z.coerce.date().optional(),
  usageLimit: z.number().int().positive().optional(),
  active: z.boolean().optional(),
});

export const couponIdParamSchema = z.object({
  id: z.string().min(1),
});

export const listCouponsQuerySchema = z.object({
  active: z.enum(['true', 'false']).optional(),
  search: z.string().max(200).optional(),
});
