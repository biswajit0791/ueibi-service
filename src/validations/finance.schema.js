import { z } from 'zod';

export const pricingPreviewSchema = z.object({
  licenseQuantity: z.number().int().positive(),
  couponCode: z.string().optional(),
  gstin: z.string().optional(),
});

export const approveSchema = z.object({
  licenseQuantity: z.number().int().positive(),
  gstin: z.string().min(1),
  couponCode: z.string().optional(),
  paymentMethod: z.enum(['ONLINE', 'CHEQUE']),
});

export const confirmChequeSchema = z.object({
  chequeNumber: z.string().min(1),
  chequeDate: z.coerce.date(),
  transactionId: z.string().min(1),
});
