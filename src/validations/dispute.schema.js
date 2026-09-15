import { z } from 'zod';

export const disputeIdParamSchema = z.object({
  id: z.string().min(1),
});

export const disputeAttachmentParamSchema = z.object({
  id: z.string().min(1),
  attachmentId: z.string().min(1),
});

export const disputeListQuerySchema = z.object({
  status: z.enum(['OPEN', 'IN_PROGRESS', 'RESOLVED']).optional(),
  category: z.string().max(100).optional(),
  priority: z.enum(['LOW', 'MEDIUM', 'HIGH']).optional(),
  search: z.string().max(200).optional(),
  page: z.coerce.number().int().min(1).optional().default(1),
  limit: z.coerce.number().int().min(1).max(100).optional().default(20),
});

export const disputeCreateSchema = z.object({
  subject: z.string().min(1, 'Subject is required').max(200),
  description: z.string().min(1, 'Description is required').max(5000),
  category: z.string().max(100).optional(),
  priority: z.enum(['LOW', 'MEDIUM', 'HIGH']).optional(),
  subjectEmployeeId: z.string().min(1).optional(),
});

export const disputeUpdateSchema = z.object({
  status: z.enum(['OPEN', 'IN_PROGRESS', 'RESOLVED']).optional(),
  priority: z.enum(['LOW', 'MEDIUM', 'HIGH']).optional(),
  assignedToId: z.string().min(1).nullable().optional(),
  resolutionNotes: z.string().max(5000).optional(),
}).refine((d) => Object.keys(d).length > 0, { message: 'At least one field must be provided' });

export const disputeMessageCreateSchema = z.object({
  body: z.string().min(1, 'Message body is required').max(5000),
});
