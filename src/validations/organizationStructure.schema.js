import { z } from 'zod';

export const createOrganizationStructureSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(100, 'Name cannot exceed 100 characters'),
  code: z
    .string()
    .trim()
    .min(1, 'Code is required')
    .max(50, 'Code cannot exceed 50 characters')
    .transform((val) => val.toUpperCase().replace(/\s+/g, '_'))
    .refine((val) => /^[A-Z0-9_-]+$/.test(val), {
      message: 'Code must only contain uppercase letters, numbers, underscores, and hyphens',
    }),
  description: z.string().trim().max(500, 'Description cannot exceed 500 characters').optional().nullable(),
  isActive: z.boolean().optional().default(true),
  displayOrder: z.coerce.number().int().min(0).optional().default(0),
});

export const updateOrganizationStructureSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(100, 'Name cannot exceed 100 characters'),
  code: z
    .string()
    .trim()
    .min(1, 'Code is required')
    .max(50, 'Code cannot exceed 50 characters')
    .transform((val) => val.toUpperCase().replace(/\s+/g, '_'))
    .refine((val) => /^[A-Z0-9_-]+$/.test(val), {
      message: 'Code must only contain uppercase letters, numbers, underscores, and hyphens',
    }),
  description: z.string().trim().max(500, 'Description cannot exceed 500 characters').optional().nullable(),
  isActive: z.boolean().optional(),
  displayOrder: z.coerce.number().int().min(0).optional(),
});

export const updateOrganizationStructureStatusSchema = z.object({
  isActive: z.boolean({ required_error: 'isActive is required' }),
});

