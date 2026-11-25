import { z } from 'zod';

export const couponSchema = z.object({
  code: z.preprocess(
    (val) => (typeof val === 'string' ? (val.trim() === '' ? undefined : val.trim().toUpperCase()) : val),
    z.string().trim().toUpperCase().optional().nullable()
  ),
  discountType: z.enum(['PERCENT', 'FLAT']).optional().default('PERCENT'),
  discountValue: z.coerce.number().min(0).optional(),
  // Nullable as well as optional: on an edit, omitting a field means "leave it
  // alone" while null means "clear it". Without null these three could be set
  // but never unset — a coupon given a BDM or an expiry was stuck with it.
  bdmName: z.string().nullish(),
  salesRepId: z.string().nullish(),
  expiresAt: z.preprocess(
    (val) => (val === '' || val === null || val === undefined ? null : val),
    z.coerce.date().nullable().optional()
  ),
  usageLimit: z.coerce.number().int().positive().nullish(),
  active: z.boolean().optional(),

  // Company-Based Manual Offer System fields
  companyName: z.string().max(255).nullish(),
  industry: z.string().max(100).nullish(),
  industryId: z.string().nullish(),
  city: z.string().max(100).nullish(),
  cityId: z.string().nullish(),
  totalLicenses: z.coerce.number().int().min(0).nullish(),
  perLicenseCost: z.coerce.number().min(0).nullish(),
  licenseAmount: z.coerce.number().min(0).nullish(),
  discountPercent: z.coerce.number().min(0).max(100).nullish(),
  finalAmount: z.coerce.number().min(0).nullish(),
  startDate: z.coerce.date().nullish(),
  subscriptionYears: z.coerce.number().int().min(1).max(10).nullish().default(1),
  subscriptionDurationId: z.string().nullish(),
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
