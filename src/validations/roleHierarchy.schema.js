import { z } from 'zod';

export const assignManagerSchema = z.object({
  employeeId: z.string().trim().min(1, 'Employee ID is required').max(100, 'Employee ID exceeds max length'),
  managerId: z
    .string()
    .trim()
    .max(100, 'Manager ID exceeds max length')
    .nullable()
    .optional()
    .transform((val) => (val === '' ? null : val)),
});

export const hierarchyQuerySchema = z.object({
  department: z.string().trim().max(100, 'Department filter exceeds max length').optional(),
  search: z.string().trim().max(200, 'Search query exceeds max length').optional(),
});

export const employeeIdParamSchema = z.object({
  employeeId: z.string().trim().min(1, 'Employee ID is required').max(100, 'Employee ID exceeds max length'),
});

