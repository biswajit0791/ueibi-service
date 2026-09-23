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

export const tenantLifecycleSchema = z.object({
  status: z.enum(['ACTIVE', 'TRIAL', 'GRACE_PERIOD', 'EXPIRED', 'CANCELLED']),
  reason: z.string().max(500).optional(),
  // null clears the date; omitted leaves it untouched.
  planEndsAt: z.string().datetime().nullable().optional(),
});

export const tenantLicenceSchema = z.object({
  licenseLimit: z.coerce.number().int().min(0).max(100000),
  reason: z.string().min(5, 'Give a reason of at least 5 characters').max(500),
});

// ── Global user management ──────────────────────────────────────────────────

export const platformUserIdParamSchema = z.object({
  id: z.string().min(1),
});

export const platformUserQuerySchema = z.object({
  search: z.string().max(200).optional(),
  tenantId: z.string().max(60).optional(),
  role: z.enum(['SUPER_ADMIN', 'ADMIN', 'CMD', 'HR', 'FINANCE', 'MANAGER', 'EMPLOYEE', 'STUDENT', 'MENTOR']).optional(),
  status: z.enum(['INVITED', 'ACTIVE', 'EXITED']).optional(),
  includeDeleted: z.coerce.boolean().optional().default(false),
  page: z.coerce.number().int().min(1).optional().default(1),
  limit: z.coerce.number().int().min(1).max(100).optional().default(50),
});

export const platformUserActionSchema = z.object({
  reason: z.string().max(500).optional(),
});

// ── Tenant onboarding and verification ──────────────────────────────────────

export const registrationIdParamSchema = z.object({
  id: z.string().min(1),
});

export const onboardingQuerySchema = z.object({
  status: z.enum([
    'PENDING_FINANCE_REVIEW',
    'PENDING_CHEQUE_CONFIRMATION',
    'PENDING_HR_ACTIVATION',
    'ACTIVE',
  ]).optional(),
  search: z.string().max(200).optional(),
  stuckOnly: z.coerce.boolean().optional().default(false),
  page: z.coerce.number().int().min(1).optional().default(1),
  limit: z.coerce.number().int().min(1).max(100).optional().default(50),
});

export const registrationVerifySchema = z.object({
  status: z.enum(['PENDING', 'UNDER_REVIEW', 'VERIFIED', 'REJECTED']),
  // Zod 4 takes `error`, not v3's `required_error` — the latter is silently
  // ignored, which is how 21 dead messages ended up elsewhere in this codebase.
  notes: z.string().max(2000).optional(),
});
