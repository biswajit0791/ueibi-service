/**
 * @file exit.schema.js
 * @description Zod validation schemas for Employee Exit workflow endpoints.
 */
import { z } from 'zod';

// ── Initiate Exit ────────────────────────────────────────────────────────────
export const initiateExitSchema = z.object({
  resignationDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Resignation date must be YYYY-MM-DD'),
  lastWorkingDay: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Last working day must be YYYY-MM-DD'),
  exitReason: z.enum([
    'Resigned', 'Terminated', 'Contract Ended', 'Retired', 'Absconded', 'Other',
  ], { errorMap: () => ({ message: 'Please select a valid exit reason' }) })
    .optional()
    .default('Resigned'),
  feedbackRemarks: z.string().optional().default(''),
  noticePeriodDays: z.coerce.number().int().min(0).max(365).optional().nullable(),
});

// ── Exit Interview ───────────────────────────────────────────────────────────
export const exitInterviewSchema = z.object({
  exitInterviewNotes: z.string().min(1, 'Interview notes are required'),
  exitInterviewDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Interview date must be YYYY-MM-DD'),
  exitInterviewConductedBy: z.string().min(1, 'Conducted by is required'),
});

// ── Clearance Approval ──────────────────────────────────────────────────────
export const clearanceSchema = z.object({
  department: z.enum(['it', 'hr', 'finance', 'manager'], {
    errorMap: () => ({ message: 'Department must be one of: it, hr, finance, manager' }),
  }),
  cleared: z.boolean().default(true),
  remarks: z.string().optional(),
});

// ── Complete Exit ────────────────────────────────────────────────────────────
export const completeExitSchema = z.object({
  serviceStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Service start date must be YYYY-MM-DD'),
  serviceEnd: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Service end date must be YYYY-MM-DD'),
  techRating: z.coerce.number().int().min(1).max(10).optional().default(8),
  attitudeRating: z.coerce.number().int().min(1).max(10).optional().default(8),
  conductValue: z.enum(['Excellent', 'Good', 'Average', 'Poor']).optional().default('Good'),
  feedback: z.string().optional().default(''),
  docs: z.any().optional(),
});

// ── Certificate Generation ──────────────────────────────────────────────────
export const certificateTypeSchema = z.object({
  type: z.enum(['relieving', 'service', 'refcheck'], {
    errorMap: () => ({ message: 'Certificate type must be "relieving", "service", or "refcheck"' }),
  }),
});

// ── Param schemas ────────────────────────────────────────────────────────────
export const exitIdParamSchema = z.object({
  id: z.string().min(1, 'Exit details ID is required'),
});

export const employeeIdParamSchema = z.object({
  employeeId: z.string().min(1, 'Employee ID is required'),
});
