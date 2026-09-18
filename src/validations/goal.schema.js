import { z } from 'zod';

export const createGoalSchema = z.object({
  title: z.string({ required_error: "Goal title is required" }).trim().min(1, "Goal title cannot be empty").max(255, "Goal title cannot exceed 255 characters"),
  description: z.string().max(3000, "Description cannot exceed 3000 characters").nullable().optional(),
  category: z.string().max(100).nullable().optional(),
  goalType: z.string().max(100).nullable().optional(),
  // Priority is a tenant-managed master list, so this can no longer be a fixed
  // z.enum — an admin adding "Urgent" would otherwise get a 400 on every save.
  // Shape validation only here (lowercased, bounded); membership of the
  // tenant's own active list is checked in the controller, which is the only
  // place that knows the tenant. The four seeded values still pass unchanged.
  priority: z.preprocess(
    (val) => (typeof val === 'string' ? val.toLowerCase().trim() : val),
    z.string().min(1).max(50)
  ).optional().default('medium'),
  financialYear: z.string().max(50).nullable().optional(),
  quarter: z.string().max(50).nullable().optional(),
  startDate: z.string().nullable().optional(),
  targetDate: z.string().nullable().optional(),
  dueDate: z.string().nullable().optional(),
  attachments: z.array(z.string().max(1024)).max(20, "A goal can have at most 20 attachments").optional().default([]),
  specialNotes: z.string().max(2000, "Special notes cannot exceed 2000 characters").nullable().optional(),
  employeeId: z.string().optional(),
  employeeIds: z.array(z.string().min(1, "Employee ID cannot be empty")).max(200).optional(),
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

// NOTE: `status` is deliberately NOT accepted here. Advancing the review
// workflow must go through the dedicated /submit, /approve, /reject,
// /hr-approve, /hr-reject and /resubmit endpoints — a plain PATCH must not be
// able to jump a goal straight to COMPLETED.
//
// Re-assignment: existing assignees are immutable; however elevated roles
// (HR / Admin / Super-Admin) MAY add NEW employees to an existing goal by
// supplying `addEmployeeIds` — a list of employee IDs to upsert as additional
// GoalAssignment rows. Existing assignments are never removed or replaced.
export const updateGoalSchema = z.object({
  title: z.string().trim().min(1, "Goal title cannot be empty").max(255, "Goal title cannot exceed 255 characters").optional(),
  description: z.string().max(3000, "Description cannot exceed 3000 characters").nullable().optional(),
  category: z.string().max(100).nullable().optional(),
  goalType: z.string().max(100).nullable().optional(),
  priority: z.preprocess(
    (val) => (typeof val === 'string' ? val.toLowerCase().trim() : val),
    z.string().min(1).max(50)
  ).optional(),
  financialYear: z.string().max(50).nullable().optional(),
  quarter: z.string().max(50).nullable().optional(),
  startDate: z.string().nullable().optional(),
  targetDate: z.string().nullable().optional(),
  dueDate: z.string().nullable().optional(),
  attachments: z.array(z.string().max(1024)).max(20, "A goal can have at most 20 attachments").optional(),
  specialNotes: z.string().max(2000, "Special notes cannot exceed 2000 characters").nullable().optional(),
  // IDs of employees to ADD to this goal (elevated roles only; never removes existing assignees)
  addEmployeeIds: z.array(z.string().min(1)).max(200).optional(),
});
// (default zod behaviour strips unknown keys, so stray `status` / `employeeId`
//  in the payload are silently dropped rather than applied.)

export const goalSubmitSchema = z.object({
  comment: z.string().max(1000, "Comment cannot exceed 1000 characters").optional(),
  targetEmployeeId: z.string().optional(),
}).passthrough();

export const goalApproveSchema = z.object({
  comment: z.string().max(1000, "Comment cannot exceed 1000 characters").optional(),
  rating: z.number().min(1, "Rating must be between 1 and 5").max(5, "Rating must be between 1 and 5").optional(),
  employeeId: z.string().optional(),
  targetEmployeeId: z.string().optional(),
}).passthrough();

export const goalRejectSchema = z.object({
  comment: z.string({ required_error: "Rejection reason / required changes is required" })
    .trim()
    .min(1, "Rejection reason / required changes cannot be empty")
    .max(1000, "Rejection reason cannot exceed 1000 characters"),
  employeeId: z.string().optional(),
  targetEmployeeId: z.string().optional(),
}).passthrough();

export const goalResubmitSchema = z.object({
  comment: z.string().max(1000, "Comment cannot exceed 1000 characters").optional(),
  targetEmployeeId: z.string().optional(),
}).passthrough();

export const goalReviewSchema = z.object({
  action: z.enum(['APPROVE', 'REJECT']),
  comment: z.string().max(1000, "Review comment cannot exceed 1000 characters").optional(),
  rating: z.number().min(1, "Rating must be between 1 and 5").max(5, "Rating must be between 1 and 5").optional(),
  employeeId: z.string().optional(),
  targetEmployeeId: z.string().optional(),
}).passthrough().refine(
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

export const goalCommentSchema = z.object({
  comment: z.string({ required_error: "Comment text is required" })
    .trim()
    .min(1, "Comment text cannot be empty")
    .max(2000, "Comment text cannot exceed 2000 characters"),
  attachments: z.array(z.string()).optional().default([]),
}).passthrough();

export const goalIdParamSchema = z.object({
  id: z.string().min(1),
});

export const goalCommentParamSchema = z.object({
  id: z.string().min(1),
  cid: z.string().min(1),
});

// status/category/scope stay loose (bounded strings, not strict enums) — the
// status field has legacy lowercase aliases mixed with canonical uppercase
// values (see GOAL_STATUS in goal.service.js), so an enum here risks
// rejecting a value the frontend still legitimately sends.
export const listGoalsQuerySchema = z.object({
  employeeId: z.string().max(100).optional(),
  status: z.string().max(50).optional(),
  financialYear: z.string().max(50).optional(),
  category: z.string().max(100).optional(),
  scope: z.string().max(50).optional(),
  page: z.coerce.number().int().min(1).optional().default(1),
  limit: z.coerce.number().int().min(1).max(200).optional().default(100),
});
