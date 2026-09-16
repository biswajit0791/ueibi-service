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

export const departmentIdParamSchema = z.object({
  id: z.string().min(1),
});

/**
 * Query options for GET /departments.
 *
 * `limit` is intentionally optional with NO default: the department list also
 * backs the "select a department" dropdowns (Employee Records, Team
 * Directory), which need every department. Paginating by default would
 * silently truncate those, so a page is only sliced when the caller
 * explicitly asks for a limit.
 */
export const listDepartmentsQuerySchema = z.object({
  includeArchived: z.enum(['true', 'false']).optional(),
  search: z.string().trim().max(200).optional(),
  page: z.coerce.number().int().min(1).optional().default(1),
  limit: z.coerce.number().int().min(1).max(200).optional(),
});
