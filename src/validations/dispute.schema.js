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

/**
 * A ticket can name several employees when one issue covers more than one
 * person. The form posts multipart/form-data, where a repeated field arrives as
 * an array and a single one as a bare string, so both shapes are normalised
 * here into an array of ids. A JSON array in a single field is accepted too,
 * which keeps API clients simple.
 */
const employeeIdList = z.preprocess((raw) => {
  if (raw === undefined || raw === null || raw === '') return undefined;
  let values = raw;
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (trimmed.startsWith('[')) {
      try {
        values = JSON.parse(trimmed);
      } catch {
        return raw; // let the array check below reject it with a clear message
      }
    } else {
      values = trimmed.split(',');
    }
  }
  if (!Array.isArray(values)) return raw;
  const cleaned = [...new Set(values.map((v) => String(v).trim()).filter(Boolean))];
  return cleaned.length ? cleaned : undefined;
}, z.array(z.string().min(1)).min(1).max(25).optional());

export const disputeCreateSchema = z.object({
  subject: z.string().min(1, 'Subject is required').max(200),
  description: z.string().min(1, 'Description is required').max(5000),
  category: z.string().max(100).optional(),
  priority: z.enum(['LOW', 'MEDIUM', 'HIGH']).optional(),
  // Retained so existing callers posting a single id keep working unchanged.
  subjectEmployeeId: z.string().min(1).optional(),
  subjectEmployeeIds: employeeIdList,
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
