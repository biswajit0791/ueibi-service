import { z } from 'zod';

export const createPolicySchema = z.object({
  title: z.string().min(1, 'Policy title is required').max(200, 'Title is too long'),
  content: z.string().min(1, 'Policy content is required'),
  category: z.string().min(1).default('Compliance'),
  description: z.string().optional().nullable(),
  status: z.enum(['DRAFT', 'PUBLISHED']).default('PUBLISHED'),
  pdfUrl: z.string().optional().nullable(),
  pdfOriginalName: z.string().optional().nullable(),
  effectiveDate: z.string().optional().nullable(),
  dueDate: z.string().optional().nullable(),
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
  dueAt: z.string().optional().nullable(),
});

export const reminderSchema = z.object({
  userId: z.string().optional().nullable(),
  customMessage: z.string().optional().nullable(),
});
