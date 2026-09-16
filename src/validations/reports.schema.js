import { z } from 'zod';

/** The five report keys the exporter can generate — all CSV, all backed by real data. */
export const REPORT_KEYS = [
  'appraisal-summary',
  'department-summary',
  'goal-completion',
  'peer-feedback-audit',
  'performance-goal-matrix',
];

export const analyticsQuerySchema = z.object({
  // Omit cycleId to fall back to the tenant's most recent cycle.
  cycleId: z.string().max(100).optional(),
  department: z.string().max(200).optional(),
});

export const trendQuerySchema = z.object({
  frequency: z.enum(['ANNUAL', 'QUARTERLY', 'MONTHLY']).optional(),
  department: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(2).max(24).optional().default(8),
});

export const catalogQuerySchema = z.object({
  cycleId: z.string().max(100).optional(),
  department: z.string().max(200).optional(),
});

export const exportParamSchema = z.object({
  reportKey: z.enum(REPORT_KEYS),
});

export const exportQuerySchema = z.object({
  cycleId: z.string().max(100).optional(),
  department: z.string().max(200).optional(),
  // 4-digit appraisal form, e.g. "FY 2026-2027"; converted at the Goal/Task
  // query boundary via toGoalsFinancialYear().
  financialYear: z.string().max(100).optional(),
});
