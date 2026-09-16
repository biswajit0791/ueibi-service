import { z } from 'zod';

export const listRegistrationsQuerySchema = z.object({
  status: z.enum(['PENDING_FINANCE_REVIEW', 'PENDING_CHEQUE_CONFIRMATION', 'PENDING_HR_ACTIVATION', 'ACTIVE']).optional(),
  search: z.string().max(200).optional(),
  page: z.coerce.number().int().min(1).optional().default(1),
  limit: z.coerce.number().int().min(1).max(100).optional().default(20),
});

export const registrationIdParamSchema = z.object({
  id: z.string().min(1),
});
