import { z } from 'zod';

export const dependencySchema = z.object({
  type: z.enum(['pre', 'post']),
  concernedPersonId: z.string().min(1, "Concerned person ID is required"),
  concernedPersonName: z.string().optional(),
  concernedManagerId: z.string().optional(),
  concernedManagerName: z.string().optional(),
  title: z.string().min(1, "Dependency title is required"),
  description: z.string().nullable().optional(),
  dueDate: z.string().min(1, "Due date is required"),
  status: z.string().optional(),
  createdTaskId: z.string().optional(),
  isManuallyHeldByOwnManager: z.boolean().optional(),
  manualHoldRequested: z.boolean().optional(),
}).passthrough();

export const createTaskSchema = z.object({
  title: z.string().min(1, "Task title is required"),
  priority: z.string().nullable().optional(),
  startDate: z.string().nullable().optional(),
  dueDate: z.string().nullable().optional(),
  financialYear: z.string().nullable().optional(),
  tags: z.string().nullable().optional(),
  goalId: z.string().nullable().optional(),
  isPrivate: z.boolean().optional(),
  isStandalone: z.boolean().optional(),
  weight: z.number().optional(),
  description: z.string().nullable().optional(),
  employeeId: z.string().nullable().optional(),
  dependency: dependencySchema.nullable().optional(),
  isDependencyOf: z.string().nullable().optional(),
  status: z.string().optional(),
  progress: z.number().optional(),
}).passthrough();

export const updateTaskSchema = z.object({
  title: z.string().min(1, "Task title is required").optional(),
  priority: z.string().nullable().optional(),
  startDate: z.string().nullable().optional(),
  dueDate: z.string().nullable().optional(),
  financialYear: z.string().nullable().optional(),
  tags: z.string().nullable().optional(),
  goalId: z.string().nullable().optional(),
  isPrivate: z.boolean().optional(),
  isStandalone: z.boolean().optional(),
  weight: z.number().optional(),
  description: z.string().nullable().optional(),
  employeeId: z.string().nullable().optional(),
  dependency: dependencySchema.nullable().optional(),
  isDependencyOf: z.string().nullable().optional(),
  status: z.string().optional(),
  progress: z.number().optional(),
}).passthrough();

export const createTaskCommentSchema = z.object({
  comment: z.string().max(2000, "Comment cannot exceed 2000 characters").optional().default(''),
}).passthrough();

