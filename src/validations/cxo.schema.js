import { z } from 'zod';

// Zod 4: the v3 `required_error` option is ignored, so custom messages use
// `{ error: '...' }` — see validations/message.schema.js for the same note.

export const CXO_CATEGORIES = ['APPRECIATION', 'SUGGESTION', 'CONCERN', 'QUESTION'];
export const CXO_STATUSES = ['PENDING', 'ACKNOWLEDGED', 'REPLIED', 'CLOSED'];

const id = (label) =>
  z.string({ error: `${label} is required` }).trim().min(1, `${label} cannot be empty`).max(100, `${label} is too long`);

export const createCxoMessageSchema = z.object({
  subject: z
    .string({ error: 'Subject is required' })
    .trim()
    .min(3, 'Subject must be at least 3 characters')
    .max(150, 'Subject cannot exceed 150 characters'),
  body: z
    .string({ error: 'Message is required' })
    .trim()
    .min(10, 'Message must be at least 10 characters')
    .max(5000, 'Message cannot exceed 5000 characters'),
  category: z.enum(CXO_CATEGORIES, { error: `Category must be one of: ${CXO_CATEGORIES.join(', ')}` }).default('SUGGESTION'),
  isAnonymous: z.coerce.boolean().default(false),
  targetLeaderId: id('targetLeaderId').nullish(),
});

export const listCxoQuerySchema = z.object({
  status: z.enum(CXO_STATUSES).optional(),
  category: z.enum(CXO_CATEGORIES).optional(),
  // Lets a leader look at their OWN raised messages instead of the inbox.
  scope: z.enum(['mine', 'leadership']).optional(),
});

export const cxoIdParamSchema = z.object({ id: id('Message ID') });

export const addCxoReplySchema = z.object({
  body: z
    .string({ error: 'Reply is required' })
    .trim()
    .min(1, 'Reply cannot be empty')
    .max(5000, 'Reply cannot exceed 5000 characters'),
});

export const updateCxoMessageSchema = z
  .object({
    status: z.enum(CXO_STATUSES).optional(),
    assignedToId: id('assignedToId').optional(),
  })
  .refine((d) => d.status || d.assignedToId, {
    message: 'Provide a status or an assignee',
  });

export const grantCapabilitySchema = z.object({
  userId: id('userId'),
  capability: z.enum(['LEADERSHIP'], { error: 'Unknown capability' }).default('LEADERSHIP'),
  title: z.string().trim().max(100, 'Title cannot exceed 100 characters').nullish(),
});

export const revokeCapabilitySchema = z.object({
  userId: id('userId'),
  capability: z.enum(['LEADERSHIP'], { error: 'Unknown capability' }).default('LEADERSHIP'),
});
