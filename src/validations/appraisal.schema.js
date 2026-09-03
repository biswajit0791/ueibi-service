import { z } from 'zod';

// ── Cycle & Parameter ─────────────────────────────────────────────────────────

export const updateCycleSchema = z.object({
  name:      z.string().min(1, 'Cycle name is required').max(100).optional(),
  frequency: z.enum(['ANNUAL', 'QUARTERLY', 'MONTHLY']).optional(),
  startDate: z.string().datetime({ offset: true }).optional(),
  endDate:   z.string().datetime({ offset: true }).optional(),
  status:    z.enum(['ACTIVE', 'CLOSED']).optional(),
}).refine(data => Object.keys(data).length > 0, {
  message: 'At least one field must be provided',
});

export const updateParameterSchema = z.object({
  name:     z.string().min(1, 'Parameter name is required').max(100).optional(),
  order:    z.number().int().min(1).max(20).optional(),
  isActive: z.boolean().optional(),
}).refine(data => Object.keys(data).length > 0, {
  message: 'At least one field must be provided',
});

// ── Self Assessment ───────────────────────────────────────────────────────────

export const selfAssessmentSchema = z.object({
  selfAccomplishments: z
    .string()
    .max(5000, 'Accomplishments must be under 5000 characters')
    .optional(),
  selfWeaknesses: z
    .string()
    .max(5000, 'Weaknesses must be under 5000 characters')
    .optional(),
  selfRating: z
    .number()
    .min(1, 'Rating must be at least 1')
    .max(5, 'Rating cannot exceed 5')
    .optional(),
  submit: z.boolean().optional().default(false),
  scores: z
    .array(
      z.object({
        parameterId: z.string().min(1, 'Parameter ID is required'),
        selfScore:   z.number().int().min(1).max(5),
      })
    )
    .optional(),
});

export const submitSelfRatingSchema = z.object({
  cycleId: z.string().optional(),
  frequency: z.enum(['ANNUAL', 'QUARTERLY', 'MONTHLY']).optional(),
  periodName: z.string().optional(),
  rating: z.number().min(1).max(5).optional(),
  comments: z.string().max(5000).optional(),
  selfAccomplishments: z.string().max(5000).optional(),
  selfWeaknesses: z.string().max(5000).optional(),
  selfRating: z.number().min(1).max(5).optional(),
  submit: z.boolean().optional().default(true),
  scores: z
    .array(
      z.object({
        parameterId: z.string().min(1, 'Parameter ID is required'),
        selfScore:   z.number().int().min(1).max(5).optional(),
        score:       z.number().int().min(1).max(5).optional(),
      })
    )
    .optional(),
});

// ── Manager Review ────────────────────────────────────────────────────────────

export const managerReviewSchema = z.object({
  managerRemarks: z
    .string()
    .max(5000, 'Manager remarks must be under 5000 characters')
    .optional(),
  managerComments: z
    .string()
    .max(5000, 'Manager comments must be under 5000 characters')
    .optional(),
  managerRating: z
    .number()
    .min(1, 'Rating must be at least 1')
    .max(5, 'Rating cannot exceed 5')
    .optional(),
  scores: z
    .array(
      z.object({
        parameterId:  z.string().min(1, 'Parameter ID is required'),
        managerScore: z.number().int().min(1).max(5),
      })
    )
    .optional(),
}).refine(data => Object.keys(data).length > 0, {
  message: 'At least one field must be provided',
});

// ── HR Audit & Hike ───────────────────────────────────────────────────────────

export const hrAuditSchema = z.object({
  hikePercentage: z
    .number()
    .min(0, 'Hike percentage cannot be negative')
    .max(100, 'Hike percentage cannot exceed 100%')
    .optional(),
  hrSignoffStatus: z
    .enum(['PENDING_RELEASE', 'RELEASED'], {
      errorMap: () => ({ message: 'Status must be PENDING_RELEASE or RELEASED' }),
    })
    .optional(),
  hrRemarks: z
    .string()
    .max(3000, 'HR remarks must be under 3000 characters')
    .optional(),
  scores: z
    .array(
      z.object({
        parameterId: z.string().min(1, 'Parameter ID is required'),
        hrScore:     z.number().int().min(1).max(5),
      })
    )
    .optional(),
}).refine(data => Object.keys(data).length > 0, {
  message: 'At least one field must be provided',
});

// ── Peer Nomination ───────────────────────────────────────────────────────────

export const peerNominationSchema = z.object({
  reviewerId: z.string().min(1, 'Reviewer ID is required'),
});

// ── Peer Feedback Submission ──────────────────────────────────────────────────

export const peerFeedbackSchema = z.object({
  rating: z
    .number()
    .min(1, 'Rating must be at least 1')
    .max(5, 'Rating cannot exceed 5'),
  strengths: z
    .string()
    .min(10, 'Strengths must be at least 10 characters')
    .max(3000, 'Strengths must be under 3000 characters'),
  growthAreas: z
    .string()
    .min(10, 'Growth areas must be at least 10 characters')
    .max(3000, 'Growth areas must be under 3000 characters'),
});

// ── Ex-Employer Verification Request ─────────────────────────────────────────

export const exEmployerRequestSchema = z.object({
  exCompany:      z.string().min(2, 'Company name must be at least 2 characters').max(200),
  exManagerName:  z.string().min(2, 'Manager name must be at least 2 characters').max(100),
  exManagerEmail: z.string().email('Must be a valid email address'),
});

// ── Public Ex-Employer Review Submit ─────────────────────────────────────────

export const publicExReviewSubmitSchema = z.object({
  rating: z
    .number()
    .min(1, 'Rating must be at least 1')
    .max(5, 'Rating cannot exceed 5'),
  feedback: z
    .string()
    .min(20, 'Feedback must be at least 20 characters')
    .max(5000, 'Feedback must be under 5000 characters'),
});

// ── General Review Update Schema ─────────────────────────────────────────────

export const updateReviewSchema = z.object({
  selfAccomplishments: z.string().max(5000).optional(),
  selfWeaknesses: z.string().max(5000).optional(),
  selfRating: z.number().min(1).max(5).optional(),
  managerRemarks: z.string().max(5000).optional(),
  managerRating: z.number().min(1).max(5).optional(),
  status: z.enum(['DRAFT', 'SUBMITTED', 'MANAGER_REVIEWED', 'COMPLETED']).optional(),
  hikePercentage: z.number().min(0).max(100).optional(),
}).refine(data => Object.keys(data).length > 0, {
  message: 'At least one field must be provided for update',
});

// ── Query Schemas ─────────────────────────────────────────────────────────────

export const listAppraisalsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).optional().default(1),
  limit: z.coerce.number().int().min(1).max(100).optional().default(10),
  search: z.string().max(200).optional(),
  frequency: z.enum(['ANNUAL', 'QUARTERLY', 'MONTHLY']).optional(),
  status: z.enum(['DRAFT', 'SUBMITTED', 'MANAGER_REVIEWED', 'COMPLETED']).optional(),
});

export const activeCycleQuerySchema = z.object({
  frequency: z.enum(['ANNUAL', 'QUARTERLY', 'MONTHLY']).optional(),
  period: z.string().max(100).optional(),
  cycleId: z.string().optional(),
});

// ── Goal Alignment Schemas ───────────────────────────────────────────────────

export const syncGoalsToAppraisalSchema = z.object({
  reviewId: z.string().min(1).optional(),
  cycleId: z.string().min(1).optional(),
  frequency: z.enum(['ANNUAL', 'QUARTERLY', 'MONTHLY']).optional().default('MONTHLY'),
  periodName: z.string().max(100).optional(),
});

export const myGoalsQuerySchema = z.object({
  employeeId: z.string().max(100).optional(),
  page: z.coerce.number().int().min(1).optional().default(1),
  limit: z.coerce.number().int().min(1).max(100).optional().default(5),
  search: z.string().max(200).optional(),
  status: z.string().max(50).optional(),
  category: z.string().max(100).optional(),
});

export const reviewIdParamSchema = z.object({
  id: z.string().min(1, 'Review ID is required').max(100),
});


