import { z } from 'zod';

export const couponSchema = z.object({
  code: z.string().min(1).toUpperCase().optional(),
  discountType: z.enum(['PERCENT', 'FLAT']).optional().default('PERCENT'),
  discountValue: z.coerce.number().min(0).optional(),
  // Nullable as well as optional: on an edit, omitting a field means "leave it
  // alone" while null means "clear it". Without null these three could be set
  // but never unset — a coupon given a BDM or an expiry was stuck with it.
  bdmName: z.string().nullish(),
  salesRepId: z.string().nullish(),
  expiresAt: z.coerce.date().nullish(),
  usageLimit: z.coerce.number().int().positive().nullish(),
  active: z.boolean().optional(),

  // Company-Based Manual Offer System fields
  companyName: z.string().max(255).nullish(),
  industry: z.string().max(100).nullish(),
  city: z.string().max(100).nullish(),
  totalLicenses: z.coerce.number().int().positive().nullish(),
  perLicenseCost: z.coerce.number().positive().nullish(),
  licenseAmount: z.coerce.number().nullish(),
  discountPercent: z.coerce.number().min(0).max(100).nullish(),
  finalAmount: z.coerce.number().nullish(),
  startDate: z.coerce.date().nullish(),
  promoMonths: z.coerce.number().int().min(0).nullish().default(0),
  endDate: z.coerce.date().nullish(),
  offerReference: z.string().max(100).nullish(),
  status: z.enum(['UNUSED', 'USED', 'EXPIRED']).nullish().default('UNUSED'),
});

export const couponIdParamSchema = z.object({
  id: z.string().min(1),
});

export const listCouponsQuerySchema = z.object({
  active: z.enum(['true', 'false']).optional(),
  search: z.string().max(200).optional(),
  filter: z.enum(['ALL', 'MY', 'UNUSED', 'USED', 'EXPIRED']).optional(),
  salesRepId: z.string().optional(),
  company: z.string().optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
});
