import { z } from 'zod';

/**
 * Validation for the billing modules.
 *
 * Zod 4 throughout: custom messages go in `{ error: '…' }`. v3's `required_error`
 * is silently ignored by Zod 4 and must not be used — there are already 21 dead
 * messages elsewhere in this codebase from exactly that mistake.
 */

const idParam = z.object({ id: z.string().min(1) });

export const packageIdParamSchema = idParam;
export const invoiceIdParamSchema = idParam;
export const subscriptionIdParamSchema = idParam;

// ── Packages ────────────────────────────────────────────────────────────────

const INTERVALS = ['ONE_TIME', 'MONTHLY', 'QUARTERLY', 'ANNUAL'];

export const packageCreateSchema = z.object({
  name: z.string({ error: 'A package needs a name' }).trim().min(2).max(120),
  description: z.string().max(2000).nullish(),
  seatCount: z.coerce.number().int().min(1, 'A package must include at least one seat').max(100000),
  interval: z.enum(INTERVALS).default('ANNUAL'),
  // Null is meaningful here (perpetual), so nullish rather than optional.
  termMonths: z.coerce.number().int().min(1).max(120).nullish(),
  unitPrice: z.coerce.number().positive('The price per seat must be above zero').max(10000000),
  currency: z.string().length(3).default('INR'),
  active: z.boolean().default(true),
  sortOrder: z.coerce.number().int().min(0).max(9999).default(0),
}).refine(
  // A term that never ends is ONE_TIME by definition; a recurring interval with
  // no length cannot produce an end date, and a subscription without one would
  // silently become perpetual.
  (p) => p.interval === 'ONE_TIME' || p.termMonths != null,
  { error: 'A package with a billing interval needs a term length in months', path: ['termMonths'] },
);

// .partial() cannot be called on a refined schema, so the update shape is
// declared separately rather than derived.
export const packageUpdateSchema = z.object({
  name: z.string().trim().min(2).max(120).optional(),
  description: z.string().max(2000).nullish(),
  seatCount: z.coerce.number().int().min(1).max(100000).optional(),
  interval: z.enum(INTERVALS).optional(),
  termMonths: z.coerce.number().int().min(1).max(120).nullish(),
  unitPrice: z.coerce.number().positive().max(10000000).optional(),
  currency: z.string().length(3).optional(),
  active: z.boolean().optional(),
  sortOrder: z.coerce.number().int().min(0).max(9999).optional(),
});

export const packageQuerySchema = z.object({
  active: z.enum(['true', 'false']).optional(),
  search: z.string().max(200).optional(),
});

// ── Invoices ────────────────────────────────────────────────────────────────

export const invoiceQuerySchema = z.object({
  state: z.enum(['DRAFT', 'ISSUED', 'PARTIALLY_PAID', 'PAID', 'VOID']).optional(),
  tenantId: z.string().max(60).optional(),
  search: z.string().max(200).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export const invoiceCreateSchema = z.object({
  tenantId: z.string({ error: 'An invoice must belong to a company' }).min(1),
  subscriptionId: z.string().min(1).nullish(),
  packageId: z.string().min(1).nullish(),
  quantity: z.coerce.number().int().min(1, 'An invoice needs at least one seat').max(100000),
  unitPrice: z.coerce.number().positive('The price per seat must be above zero').max(10000000),
  couponCode: z.string().max(60).nullish(),
  dueAt: z.coerce.date().nullish(),
  notes: z.string().max(2000).nullish(),
});

export const invoiceVoidSchema = z.object({
  reason: z.string({ error: 'Voiding an invoice needs a reason' })
    .trim().min(5, 'Give a reason of at least 5 characters').max(500),
});

// ── Payments and refunds ────────────────────────────────────────────────────

// ONLINE stays available so a gateway payment can still be recorded if Razorpay
// is ever switched on; LEGACY is written only by the backfill, never by hand.
const RECORDABLE_METHODS = ['BANK_TRANSFER', 'UPI', 'CHEQUE', 'CASH', 'ONLINE', 'ADJUSTMENT'];

export const paymentCreateSchema = z.object({
  amount: z.coerce.number().positive('A payment must be above zero').max(100000000),
  method: z.enum(RECORDABLE_METHODS),
  reference: z.string().trim().max(120).nullish(),
  receivedAt: z.coerce.date().default(() => new Date()),
  notes: z.string().max(2000).nullish(),
}).refine(
  // Without a reference a payment cannot be reconciled against a bank statement,
  // which is the whole point of recording it. ADJUSTMENT and CASH have none by
  // nature, so they are the only exemptions.
  (p) => ['ADJUSTMENT', 'CASH'].includes(p.method) || Boolean(p.reference),
  { error: 'A bank, UPI, cheque or online payment needs its reference so it can be reconciled', path: ['reference'] },
);

export const refundCreateSchema = z.object({
  amount: z.coerce.number().positive('A refund must be above zero').max(100000000),
  reason: z.string({ error: 'A refund always needs a reason' })
    .trim().min(5, 'Give a reason of at least 5 characters').max(2000),
  method: z.enum(RECORDABLE_METHODS),
  reference: z.string().trim().max(120).nullish(),
  paymentId: z.string().min(1).nullish(),
  refundedAt: z.coerce.date().default(() => new Date()),
});

// ── Subscriptions ───────────────────────────────────────────────────────────

export const subscriptionQuerySchema = z.object({
  state: z.enum(['PENDING', 'ACTIVE', 'EXPIRED', 'CANCELLED']).optional(),
  tenantId: z.string().max(60).optional(),
  /// Terms ending within N days — the renewal queue.
  expiringInDays: z.coerce.number().int().min(1).max(365).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export const subscriptionCreateSchema = z.object({
  packageId: z.string({ error: 'Choose a package' }).min(1),
  startsAt: z.coerce.date().default(() => new Date()),
  /// Overrides the package seat count for a negotiated deal.
  seatCount: z.coerce.number().int().min(1).max(100000).nullish(),
  unitPrice: z.coerce.number().positive().max(10000000).nullish(),
  couponCode: z.string().max(60).nullish(),
  /// False raises the term without billing for it — for a migration or a gift.
  createInvoice: z.boolean().default(true),
  notes: z.string().max(2000).nullish(),
});

export const subscriptionRenewSchema = z.object({
  packageId: z.string().min(1).nullish(),
  seatCount: z.coerce.number().int().min(1).max(100000).nullish(),
  unitPrice: z.coerce.number().positive().max(10000000).nullish(),
  couponCode: z.string().max(60).nullish(),
  /// Defaults to the day the current term ends, so renewals do not leave a gap.
  startsAt: z.coerce.date().nullish(),
  createInvoice: z.boolean().default(true),
});

export const subscriptionCancelSchema = z.object({
  reason: z.string({ error: 'Cancelling a term needs a reason' })
    .trim().min(5, 'Give a reason of at least 5 characters').max(500),
  /// By default the term runs to its end date; true ends access immediately.
  immediate: z.boolean().default(false),
});

// ── Revenue ─────────────────────────────────────────────────────────────────

export const revenueQuerySchema = z.object({
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  months: z.coerce.number().int().min(1).max(36).default(12),
});
