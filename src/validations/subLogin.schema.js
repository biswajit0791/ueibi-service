import { z } from 'zod';

// Zod 4: `required_error` is ignored; custom messages use `{ error: '...' }`.

const REGISTRY_CAPS = ['REGISTRY_SEARCH', 'REGISTRY_WRITE', 'REGISTRY_ANALYTICS', 'REGISTRY_EXPORT'];

export const inviteSubLoginSchema = z.object({
  name: z
    .string({ error: 'Full name is required' })
    .trim()
    .min(2, 'Full name must be at least 2 characters')
    .max(80, 'Full name cannot exceed 80 characters'),
  email: z
    .string({ error: 'Work email is required' })
    .trim()
    .toLowerCase()
    .email('Enter a valid work email address')
    .max(160, 'Email is too long'),
  // Which dropdown preset was chosen. Only seeds defaults — `capabilities` wins.
  preset: z.enum(['RECRUITER', 'MANAGER', 'VIEWER']).optional(),
  capabilities: z
    .array(z.enum(REGISTRY_CAPS, { error: 'Unknown registry credential' }))
    .max(REGISTRY_CAPS.length)
    .optional(),
  designation: z.string().trim().max(100).optional(),
  department: z.string().trim().max(100).optional(),
});

export const updateSubLoginSchema = z.object({
  capabilities: z
    .array(z.enum(REGISTRY_CAPS, { error: 'Unknown registry credential' }))
    .max(REGISTRY_CAPS.length),
  title: z.string().trim().max(100).nullish(),
});

export const subLoginIdParamSchema = z.object({
  id: z
    .string({ error: 'User ID is required' })
    .trim()
    .min(1, 'User ID cannot be empty')
    .max(100, 'User ID is too long'),
});

export const auditQuerySchema = z.object({
  userId: z.string().trim().max(100).optional(),
  limit: z.coerce.number().int().min(1).max(500).optional().default(100),
});
