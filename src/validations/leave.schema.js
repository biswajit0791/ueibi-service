import { z } from 'zod';

export const createLeaveTypeSchema = z.object({
  name: z.string().min(2, 'Leave type name must be at least 2 characters').max(100, 'Name cannot exceed 100 characters'),
  code: z
    .string()
    .min(2, 'Code must be at least 2 characters')
    .max(30, 'Code cannot exceed 30 characters')
    .regex(/^[A-Za-z0-9_]+$/, 'Code can only contain letters, numbers, and underscores')
    .transform((val) => val.toUpperCase().trim()),
  description: z.string().max(500, 'Description cannot exceed 500 characters').optional().nullable(),
  defaultDays: z.coerce.number().min(0, 'Default days must be positive').max(365, 'Default days cannot exceed 365').default(0),
  allocationType: z.enum(['ANNUAL', 'MONTHLY', 'ACCRUAL', 'LUMP_SUM']).default('ANNUAL'),
  year: z.coerce.number().int().min(2000).max(2100).optional().nullable(),
  isPaid: z.boolean().default(true),
  requiresApproval: z.boolean().default(true),
  allowHalfDay: z.boolean().default(true),
  allowNegativeBalance: z.boolean().default(false),
  maxConsecutiveDays: z.coerce.number().int().min(1).max(365).optional().nullable(),
  minNoticeDays: z.coerce.number().int().min(0).max(90).default(0),
  carryForwardAllowed: z.boolean().default(false),
  maxCarryForwardDays: z.coerce.number().int().min(0).max(100).default(0),
  encashmentAllowed: z.boolean().default(false),
  requiresDocument: z.boolean().default(false),
  documentRequiredAfterDays: z.coerce.number().int().min(1).max(60).default(2),
  isActive: z.boolean().default(true),
});

export const updateLeaveTypeSchema = createLeaveTypeSchema.partial();

export const leaveTypeStatusSchema = z.object({
  isActive: z.boolean(),
});

export const createLeaveRequestSchema = z.object({
  requestType: z.enum(['LEAVE', 'WFH']).default('LEAVE'),
  leaveTypeId: z.string().optional().nullable(),
  type: z.string().optional(), // Legacy support
  leaveType: z.string().optional(), // Legacy support
  startDate: z.string().min(1, 'Start date is required'),
  endDate: z.string().min(1, 'End date is required'),
  dayType: z.enum(['FULL', 'FIRST_HALF', 'SECOND_HALF']).default('FULL'),
  reason: z.string().min(3, 'Reason must be at least 3 characters').max(1000, 'Reason cannot exceed 1000 characters'),
  attachmentUrl: z.string().optional().nullable(),
  attachmentOriginalName: z.string().optional().nullable(),
}).refine((data) => {
  const start = new Date(data.startDate);
  const end = new Date(data.endDate);
  return start <= end;
}, {
  message: 'Start date must be before or equal to end date',
  path: ['endDate'],
}).refine((data) => {
  // If dayType is half day, startDate must equal endDate
  if (data.dayType !== 'FULL') {
    return data.startDate === data.endDate;
  }
  return true;
}, {
  message: 'Half-day leave can only be applied for a single day',
  path: ['dayType'],
});

export const approvalActionSchema = z.object({
  action: z.enum(['APPROVE', 'REJECT']),
  comment: z.string().max(500, 'Comment cannot exceed 500 characters').optional().nullable(),
}).refine((data) => {
  if (data.action === 'REJECT' && (!data.comment || data.comment.trim().length === 0)) {
    return false;
  }
  return true;
}, {
  message: 'Rejection comment is required when rejecting a request',
  path: ['comment'],
});

export const wfhPolicySchema = z.object({
  isEnabled: z.boolean().default(true),
  annualDays: z.coerce.number().min(0, 'Annual WFH days must be 0 or more').max(365).default(15),
  requiresApproval: z.boolean().default(true),
  maxConsecutiveDays: z.coerce.number().int().min(1).max(30).optional().nullable(),
  minNoticeDays: z.coerce.number().int().min(0).max(30).default(0),
  monthlyLimit: z.coerce.number().int().min(1).max(31).optional().nullable(),
  isActive: z.boolean().default(true),
});

export const leaveBalanceAdjustmentSchema = z.object({
  employeeId: z.string().min(1, 'Employee ID is required'),
  leaveTypeId: z.string().optional().nullable(),
  isWfh: z.boolean().default(false),
  year: z.coerce.number().int().min(2000).max(2100).default(() => new Date().getFullYear()),
  adjustmentAmount: z.coerce.number({ invalid_type_error: 'Adjustment amount must be a number' }),
  reason: z.string().min(3, 'Adjustment reason must be at least 3 characters').max(500, 'Reason cannot exceed 500 characters'),
}).refine((data) => {
  if (!data.isWfh && !data.leaveTypeId) {
    return false;
  }
  return true;
}, {
  message: 'Leave type is required when adjusting leave balances',
  path: ['leaveTypeId'],
});
