import { z } from 'zod';

export function isDateInPast(dateStr) {
  if (!dateStr) return false;
  let dYear, dMonth, dDay;
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    const parts = dateStr.split('-');
    dYear = parseInt(parts[0], 10);
    dMonth = parseInt(parts[1], 10) - 1;
    dDay = parseInt(parts[2], 10);
  } else {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return false;
    dYear = d.getFullYear();
    dMonth = d.getMonth();
    dDay = d.getDate();
  }
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const targetEndOfDay = new Date(dYear, dMonth, dDay, 23, 59, 59, 999);
  return targetEndOfDay < today;
}

export const createPolicySchema = z.object({
  title: z.string().min(1, 'Policy title is required').max(200, 'Title is too long'),
  content: z.string().min(1, 'Policy content is required'),
  category: z.string().min(1).default('Compliance'),
  description: z.string().optional().nullable(),
  status: z.enum(['DRAFT', 'PUBLISHED']).default('PUBLISHED'),
  pdfUrl: z.string().optional().nullable(),
  pdfOriginalName: z.string().optional().nullable(),
  effectiveDate: z.string().optional().nullable(),
  dueDate: z
    .string()
    .optional()
    .nullable()
    .refine((val) => !val || !isDateInPast(val), {
      message: 'Sign-off due date cannot be in the past',
    }),
  assignees: z.union([z.array(z.string()), z.literal('ALL')]).optional(),
});

export const updatePolicySchema = z.object({
  title: z.string().min(1).max(200).optional(),
  content: z.string().min(1).optional(),
  category: z.string().min(1).optional(),
  description: z.string().optional().nullable(),
  status: z.enum(['DRAFT', 'PUBLISHED', 'ARCHIVED']).optional(),
  pdfUrl: z.string().optional().nullable(),
  pdfOriginalName: z.string().optional().nullable(),
  effectiveDate: z.string().optional().nullable(),
  dueDate: z.string().optional().nullable(),
  incrementVersion: z.boolean().optional(),
  assignees: z.union([z.array(z.string()), z.literal('ALL')]).optional(),
});

export const signPolicySchema = z.object({
  acknowledged: z.boolean().refine(val => val === true, {
    message: 'You must acknowledge having read and agreed to the policy',
  }),
});

export const assignPolicySchema = z.object({
  userIds: z.array(z.string()).optional(),
  target: z.enum(['ALL', 'INDIVIDUAL']).optional(),
  dueAt: z
    .string()
    .optional()
    .nullable()
    .refine((val) => !val || !isDateInPast(val), {
      message: 'Sign-off due date cannot be in the past',
    }),
});

export const reminderSchema = z.object({
  userId: z.string().optional().nullable(),
  customMessage: z.string().optional().nullable(),
});

export const publishPolicySchema = z.object({
  assignees: z.union([z.array(z.string()), z.literal('ALL')]).optional(),
});

export const policyIdParamSchema = z.object({
  id: z.string().min(1),
});

export const listPoliciesQuerySchema = z.object({
  status: z.string().max(50).optional(),
  category: z.string().max(100).optional(),
  search: z.string().max(200).optional(),
  page: z.coerce.number().int().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
});

export const complianceRegistryQuerySchema = z.object({
  policyId: z.string().max(100).optional(),
  search: z.string().max(200).optional(),
  page: z.coerce.number().int().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
});

export const policyIdQuerySchema = z.object({
  policyId: z.string().max(100).optional(),
});

