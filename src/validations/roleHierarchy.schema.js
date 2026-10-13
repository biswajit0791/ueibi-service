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

export const updatePermissionsSchema = z.object({
  role: z.enum(['SUPER_ADMIN', 'CMD', 'ADMIN', 'HR', 'FINANCE', 'MANAGER', 'EMPLOYEE']),
  permissions: z
    .array(
      z.object({
        feature: z.string().trim().min(1, 'Feature name is required').max(200),
        category: z.string().trim().min(1, 'Category name is required').max(100),
        state: z.enum(['ALLOWED', 'DENIED', 'INHERITED', 'PROTECTED']),
        label: z.string().trim().max(100).optional(),
      })
    )
    .min(1, 'At least one permission specification is required'),
});

export const resetPermissionsSchema = z.object({
  role: z.enum(['SUPER_ADMIN', 'CMD', 'ADMIN', 'HR', 'FINANCE', 'MANAGER', 'EMPLOYEE', 'ALL']).optional(),
});

export const updateVisibilitySchema = z.object({
  visibility: z.record(
    z.string(),
    z.object({
      canViewTree: z.boolean().default(true),
      canViewLadder: z.boolean().default(true),
      canViewMatrix: z.boolean().default(false),
      canViewStats: z.boolean().default(false),
      canViewDirectory: z.boolean().default(false),
      canViewDeptFilters: z.boolean().default(false),
      canUseActions: z.boolean().default(false),
    })
  ),
});

export const updateDashboardConfigSchema = z.object({
  role: z.enum(['SUPER_ADMIN', 'CMD', 'ADMIN', 'HR', 'FINANCE', 'MANAGER', 'EMPLOYEE']),
  widgets: z.array(z.string().trim().min(1).max(100)),
  allowedNavModules: z.array(z.string().trim().min(1).max(100)).optional(),
});

export const resetDashboardConfigSchema = z.object({
  role: z.enum(['SUPER_ADMIN', 'CMD', 'ADMIN', 'HR', 'FINANCE', 'MANAGER', 'EMPLOYEE', 'ALL']).optional(),
});

export const auditLogsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  action: z.string().trim().max(100).optional(),
  targetRole: z.string().trim().max(100).optional(),
});

