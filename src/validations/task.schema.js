import { z } from 'zod';

export const dependencySchema = z.preprocess(
  (val) => {
    if (typeof val === 'string') {
      try {
        return JSON.parse(val);
      } catch {
        return val;
      }
    }
    return val;
  },
  z.object({
    id: z.string().nullable().optional(),
    type: z.preprocess(
      (val) => typeof val === 'string' ? val.toLowerCase() : val,
      z.enum(['pre', 'post']).or(z.string())
    ).optional().default('pre'),
    concernedPersonId: z.string().nullable().optional(),
    assigneeId: z.string().nullable().optional(),
    concernedPersonName: z.string().nullable().optional(),
    concernedManagerId: z.string().nullable().optional(),
    concernedManagerName: z.string().nullable().optional(),
    title: z.string().nullable().optional(),
    depTitle: z.string().nullable().optional(),
    description: z.string().nullable().optional(),
    dueDate: z.string().nullable().optional(),
    status: z.string().nullable().optional(),
    createdTaskId: z.string().nullable().optional(),
    depTaskId: z.string().nullable().optional(),
    escalated: z.boolean().nullable().optional(),
    isManuallyHeldByOwnManager: z.boolean().nullable().optional(),
    manualHoldRequested: z.boolean().nullable().optional(),
  }).passthrough()
);

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
  weight: z.preprocess((v) => (v !== undefined && v !== null && v !== '' ? Number(v) : v), z.number().nullable().optional()),
  description: z.string().nullable().optional(),
  employeeId: z.string().nullable().optional(),
  dependency: dependencySchema.nullable().optional(),
  isDependencyOf: z.string().nullable().optional(),
  status: z.string().optional(),
  progress: z.preprocess((v) => (v !== undefined && v !== null && v !== '' ? Number(v) : v), z.number().nullable().optional()),
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
  weight: z.preprocess((v) => (v !== undefined && v !== null && v !== '' ? Number(v) : v), z.number().nullable().optional()),
  description: z.string().nullable().optional(),
  employeeId: z.string().nullable().optional(),
  dependency: dependencySchema.nullable().optional(),
  isDependencyOf: z.string().nullable().optional(),
  status: z.string().optional(),
  progress: z.preprocess((v) => (v !== undefined && v !== null && v !== '' ? Number(v) : v), z.number().nullable().optional()),
}).passthrough();

export const createTaskCommentSchema = z.object({
  comment: z.string().max(2000, "Comment cannot exceed 2000 characters").optional().default(''),
}).passthrough();
