import { z } from 'zod';

const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/;

/**
 * Schema for creating a new department within a tenant.
 */
export const createDepartmentSchema = z.object({
  name: z
    .string({ required_error: 'Department name is required' })
    .min(1, 'Department name cannot be empty')
    .max(80, 'Department name must be 80 characters or fewer')
    .trim(),
  description: z.string().max(200, 'Description must be 200 characters or fewer').trim().optional(),
  color: z
    .string()
    .regex(HEX_COLOR_RE, 'Color must be a valid hex code e.g. #6366f1')
    .optional(),
  sortOrder: z.coerce.number().int().min(0).optional().default(0),
});

/**
 * Schema for updating an existing department.
 * All fields are optional — only supplied fields are updated.
 */
export const updateDepartmentSchema = z.object({
  name: z
    .string()
    .min(1, 'Department name cannot be empty')
    .max(80, 'Department name must be 80 characters or fewer')
    .trim()
    .optional(),
  description: z.string().max(200).trim().optional(),
  color: z.string().regex(HEX_COLOR_RE, 'Color must be a valid hex code e.g. #6366f1').optional(),
  sortOrder: z.coerce.number().int().min(0).optional(),
  isActive: z.boolean().optional(),
});
