import { z } from 'zod';

export const createDesignationSchema = z.object({
  name: z.string().trim().min(1, 'Designation name is required').max(100, 'Designation name cannot exceed 100 characters'),
  code: z
    .string()
    .trim()
    .min(1, 'Designation code is required')
    .max(50, 'Designation code cannot exceed 50 characters')
    .transform((val) => val.toUpperCase().replace(/\s+/g, '_'))
    .refine((val) => /^[A-Z0-9_-]+$/.test(val), {
      message: 'Designation code must only contain uppercase letters, numbers, underscores, and hyphens',
    }),
  description: z.string().trim().max(500, 'Description cannot exceed 500 characters').optional().nullable(),
  isActive: z.boolean().optional().default(true),
  isDefault: z.boolean().optional().default(false),
  displayOrder: z.coerce.number().int().min(0).optional().default(0),
});

export const updateDesignationSchema = z.object({
  name: z.string().trim().min(1, 'Designation name is required').max(100, 'Designation name cannot exceed 100 characters'),
  code: z
    .string()
    .trim()
    .min(1, 'Designation code is required')
    .max(50, 'Designation code cannot exceed 50 characters')
    .transform((val) => val.toUpperCase().replace(/\s+/g, '_'))
    .refine((val) => /^[A-Z0-9_-]+$/.test(val), {
      message: 'Designation code must only contain uppercase letters, numbers, underscores, and hyphens',
    }),
  description: z.string().trim().max(500, 'Description cannot exceed 500 characters').optional().nullable(),
  isActive: z.boolean().optional(),
  isDefault: z.boolean().optional(),
  displayOrder: z.coerce.number().int().min(0).optional(),
});

export const updateDesignationStatusSchema = z.object({
  isActive: z.boolean({ required_error: 'isActive is required' }),
});
