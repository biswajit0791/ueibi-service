import { z } from 'zod';

export const createGoalSchema = z.object({
  title: z.string({ required_error: "Goal title is required" }).trim().min(1, "Goal title cannot be empty").max(255, "Goal title cannot exceed 255 characters"),
  description: z.string().max(3000, "Description cannot exceed 3000 characters").nullable().optional(),
  category: z.string().max(100).nullable().optional(),
  goalType: z.string().max(100).nullable().optional(),
  priority: z.preprocess(
    (val) => typeof val === 'string' ? val.toLowerCase() : val,
    z.enum(['low', 'medium', 'high', 'critical'])
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
}).refine(
  (data) => (data.employeeIds && data.employeeIds.length > 0) || Boolean(data.employeeId),
  { message: "At least one target employee must be selected", path: ["employeeIds"] }
);

// NOTE: `status` is deliberately NOT accepted here. Advancing the review
// workflow must go through the dedicated /submit, /approve, /reject,
// /hr-approve, /hr-reject and /resubmit endpoints — a plain PATCH must not be
// able to jump a goal straight to COMPLETED. Re-assignment (employeeId /
// employeeIds) is also not editable after creation.
export const updateGoalSchema = z.object({
  title: z.string().trim().min(1, "Goal title cannot be empty").max(255, "Goal title cannot exceed 255 characters").optional(),
  description: z.string().max(3000, "Description cannot exceed 3000 characters").nullable().optional(),
  category: z.string().max(100).nullable().optional(),
  goalType: z.string().max(100).nullable().optional(),
  priority: z.preprocess(
    (val) => typeof val === 'string' ? val.toLowerCase() : val,
    z.enum(['low', 'medium', 'high', 'critical'])
  ).optional(),
  financialYear: z.string().max(50).nullable().optional(),
  quarter: z.string().max(50).nullable().optional(),
  startDate: z.string().nullable().optional(),
  targetDate: z.string().nullable().optional(),
  dueDate: z.string().nullable().optional(),
  attachments: z.array(z.string().max(1024)).max(20, "A goal can have at most 20 attachments").optional(),
  specialNotes: z.string().max(2000, "Special notes cannot exceed 2000 characters").nullable().optional(),
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
}).passthrough().refine((data) => {
  if (data.action === 'REJECT' && (!data.comment || data.comment.trim().length === 0)) {
    return false;
  }
  return true;
}, {
  message: "Rejection comment is required when requesting changes or rejecting a goal",
  path: ["comment"],
});

export const goalCommentSchema = z.object({
  comment: z.string({ required_error: "Comment text is required" })
    .trim()
    .min(1, "Comment text cannot be empty")
    .max(2000, "Comment text cannot exceed 2000 characters"),
  attachments: z.array(z.string()).optional().default([]),
}).passthrough();
