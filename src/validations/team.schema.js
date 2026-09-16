import { z } from 'zod';

export const teamDirectoryQuerySchema = z.object({
  search: z.string().max(200).optional(),
  department: z.string().max(200).optional(),
  band: z.string().max(50).optional(),
  financialYear: z.string().max(100).optional(),
  includeSelf: z.coerce.boolean().optional().default(false),
  page: z.coerce.number().int().min(1).optional().default(1),
  limit: z.coerce.number().int().min(1).max(100).optional().default(20),
});

export const teamMemberDetailQuerySchema = z.object({
  financialYear: z.string().max(100).optional(),
});

export const employeeIdParamSchema = z.object({
  employeeId: z.string().min(1),
});

export const trainingRecordParamSchema = z.object({
  employeeId: z.string().min(1),
  id: z.string().min(1),
});

export const incidentParamSchema = z.object({
  employeeId: z.string().min(1),
  id: z.string().min(1),
});

export const attachmentUploadParamSchema = z.object({
  entityKind: z.enum(['training', 'achievements', 'incidents']),
  id: z.string().min(1),
});

export const attachmentDownloadParamSchema = attachmentUploadParamSchema.extend({
  attachmentId: z.string().min(1),
});

export const trainingRecordCreateSchema = z.object({
  name: z.string().min(1).max(200),
  mandatedBy: z.string().max(100).optional(),
  status: z.enum(['IN_PROGRESS', 'COMPLETED']).optional(),
  score: z.string().max(50).optional(),
  durationHours: z.coerce.number().int().min(0).max(10000).optional(),
  startedAt: z.string().optional(),
  completedAt: z.string().optional(),
  financialYear: z.string().max(100).optional(),
});

export const trainingRecordUpdateSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  status: z.enum(['IN_PROGRESS', 'COMPLETED']).optional(),
  approvalStatus: z.enum(['PENDING', 'APPROVED', 'REJECTED']).optional(),
  score: z.string().max(50).optional(),
  durationHours: z.coerce.number().int().min(0).max(10000).optional(),
  startedAt: z.string().optional(),
  completedAt: z.string().optional(),
}).refine((d) => Object.keys(d).length > 0, { message: 'At least one field must be provided' });

export const achievementCreateSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().min(1).max(5000),
  category: z.string().max(100).optional(),
  occurredOn: z.string().min(1),
  financialYear: z.string().max(100).optional(),
});

export const incidentCreateSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().min(1).max(5000),
  severity: z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']).optional(),
  occurredOn: z.string().min(1),
  financialYear: z.string().max(100).optional(),
});

export const incidentUpdateSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  description: z.string().min(1).max(5000).optional(),
  severity: z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']).optional(),
  status: z.enum(['OPEN', 'RESOLVED', 'ESCALATED']).optional(),
  resolutionNotes: z.string().max(5000).optional(),
}).refine((d) => Object.keys(d).length > 0, { message: 'At least one field must be provided' });
