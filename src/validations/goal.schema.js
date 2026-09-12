import { z } from 'zod';

export const createGoalSchema = z.object({
  title: z.string().min(1, 'Goal title is required'),
  description: z.string().nullable().optional(),
  category: z.string().nullable().optional(),
  goalType: z.string().nullable().optional(),
  priority: z.preprocess(
    (val) => (typeof val === 'string' ? val.toLowerCase() : val),
    z.enum(['low', 'medium', 'high', 'critical'])
  ).optional().default('medium'),
  financialYear: z.string().nullable().optional(),
  quarter: z.string().nullable().optional(),
  startDate: z.string().nullable().optional(),
  targetDate: z.string().nullable().optional(),
  attachments: z.array(z.string()).optional().default([]),
  specialNotes: z.string().nullable().optional(),
  employeeId: z.string().min(1, 'Employee ID is required').optional(),
  /**
   * approvalMode is only meaningful when a manager assigns a goal to another employee.
   *
   * MANAGER_APPROVAL  → goal starts as PENDING_APPROVAL; the assignee's reporting
   *                     manager (or HR/Admin) must activate it → ACTIVE before
   *                     tasks become workable.
   *
   * AUTO_APPROVE      → goal starts as ACTIVE immediately; tasks are workable
   *                     right away.
   *
   * null / omitted    → employee self-created goal; starts as DRAFT (existing
   *                     legacy behaviour is preserved).
   */
  approvalMode: z.enum(['MANAGER_APPROVAL', 'AUTO_APPROVE']).nullable().optional(),
}).passthrough();

export const updateGoalSchema = z.object({
  title: z.string().min(1, 'Goal title is required').optional(),
  description: z.string().nullable().optional(),
  category: z.string().nullable().optional(),
  goalType: z.string().nullable().optional(),
  priority: z.preprocess(
    (val) => (typeof val === 'string' ? val.toLowerCase() : val),
    z.enum(['low', 'medium', 'high', 'critical'])
  ).optional(),
  financialYear: z.string().nullable().optional(),
  quarter: z.string().nullable().optional(),
  startDate: z.string().nullable().optional(),
  targetDate: z.string().nullable().optional(),
  attachments: z.array(z.string()).optional(),
  specialNotes: z.string().nullable().optional(),
  employeeId: z.string().optional(),
  status: z.string().optional(),
  rating: z.number().min(1).max(5).optional(),
}).passthrough();

export const goalReviewSchema = z.object({
  action: z.enum(['APPROVE', 'REJECT']),
  comment: z.string().max(1000, 'Review comment cannot exceed 1000 characters').optional(),
  rating: z.number().min(1).max(5).optional(),
}).refine(
  (data) => {
    if (data.action === 'REJECT' && (!data.comment || data.comment.trim().length === 0)) {
      return false;
    }
    return true;
  },
  {
    message: 'Rejection comment is required when requesting changes or rejecting a goal',
    path: ['comment'],
  }
);

/**
 * Schema for POST /goals/:id/activate-approve
 * Transitions a PENDING_APPROVAL goal → ACTIVE.
 * Only the goal-owner's reporting manager (or HR / Admin) can call this.
 */
export const activateApproveSchema = z.object({
  comment: z.string().max(500).optional(),
});
