import { z } from 'zod';

export const pricingPreviewSchema = z.object({
  licenseQuantity: z.number().int().positive().optional(),
  couponCode: z.string().optional().nullable(),
  gstin: z.string().optional().nullable(),
});

export const approveSchema = z.object({
  licenseQuantity: z.number().int().positive().optional(),
  gstin: z.string().optional().nullable(),
  couponCode: z.string().optional().nullable(),
  paymentMethod: z.enum(['ONLINE', 'CHEQUE']),
});

export const confirmChequeSchema = z.object({
  chequeNumber: z.string().min(1, 'Cheque number is required'),
  chequeDate: z.coerce.date(),
  transactionId: z.string().min(1, 'Transaction ID / Bank reference is required'),
});

export const createOrderSchema = z.object({
  licenseQuantity: z.number().int().positive().optional(),
  gstin: z.string().optional().nullable(),
  couponCode: z.string().optional().nullable(),
});

export const verifyPaymentSchema = z.object({
  licenseQuantity: z.number().int().positive().optional(),
  gstin: z.string().optional().nullable(),
  couponCode: z.string().optional().nullable(),
  razorpay_order_id: z.string().min(1),
  razorpay_payment_id: z.string().min(1),
  razorpay_signature: z.string().min(1),
});
