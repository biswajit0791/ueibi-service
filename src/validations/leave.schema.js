import { z } from 'zod';

export const createLeaveRequestSchema = z.object({
  requestType: z.enum(['LEAVE', 'WFH']).default('LEAVE'),
  type: z.string().optional(), // 'Casual Leave' | 'Sick Leave' | 'Annual Leave' | 'WFH'
  leaveType: z.string().optional(),
  startDate: z.string().min(1, "Start date is required"),
  endDate: z.string().min(1, "End date is required"),
  reason: z.string().min(3, "Reason must be at least 3 characters").max(1000, "Reason cannot exceed 1000 characters"),
}).refine((data) => {
  const start = new Date(data.startDate);
  const end = new Date(data.endDate);
  return start <= end;
}, {
  message: "Start date must be before or equal to end date",
  path: ["endDate"],
});

export const approvalActionSchema = z.object({
  action: z.enum(['APPROVE', 'REJECT']),
  comment: z.string().max(500, "Comment cannot exceed 500 characters").optional(),
}).refine((data) => {
  if (data.action === 'REJECT' && (!data.comment || data.comment.trim().length === 0)) {
    return false;
  }
  return true;
}, {
  message: "Rejection comment is required when rejecting a request",
  path: ["comment"],
});
