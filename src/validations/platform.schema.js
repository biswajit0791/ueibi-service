import { z } from 'zod';

export const platformTenantQuerySchema = z.object({
  search: z.string().max(200).optional(),
  page: z.coerce.number().int().min(1).optional().default(1),
  limit: z.coerce.number().int().min(1).max(100).optional().default(20),
});

export const tenantIdParamSchema = z.object({
  id: z.string().min(1),
});

export const suspendTenantSchema = z.object({
  // A reason is required, not optional: an unexplained suspension is the kind
  // of entry that makes an audit trail useless six months later.
  reason: z.string().min(5, 'Give a reason of at least 5 characters').max(500),
});

export const platformAuditQuerySchema = z.object({
  action: z.string().max(60).optional(),
  tenantId: z.string().max(60).optional(),
  page: z.coerce.number().int().min(1).optional().default(1),
  limit: z.coerce.number().int().min(1).max(100).optional().default(50),
});
