import { z } from 'zod';
import { TASK_STATUSES } from '../lib/workflowStatus.js';

const taskStatusSchema = z.enum(TASK_STATUSES);
const weightSchema = z.preprocess(
  (v) => (v !== undefined && v !== null && v !== '' ? Number(v) : v),
  z.number().int().min(1, 'Weight must be at least 1').max(100, 'Weight cannot exceed 100').nullable().optional()
);
/**
 * Task completion, 0-100.
 *
 * Rounded as well as clamped. `progress` is an Int column, so a fractional
 * value passed the old clamp-only check and then failed inside Prisma as a
 * 500. That was unreachable while the UI only offered fixed steps; it stopped
 * being unreachable the moment people could type their own figure.
 */
const progressSchema = z.preprocess(
  (v) => {
    if (v === undefined || v === null || v === '') return v;
    const n = Number(v);
    return Number.isNaN(n) ? n : Math.round(Math.min(100, Math.max(0, n)));
  },
  z.number().int().min(0).max(100).nullable().optional()
);

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
  // When work REALLY began and ended, as opposed to the planned dates above.
  // Supplied for work that started before it was entered into the system; left
  // out, they are stamped automatically as the task moves. See the controller
  // for the two rules that apply: no future dates, and completion not before
  // start.
  actualStartDate: z.string().nullable().optional(),
  actualCompletionDate: z.string().nullable().optional(),
  financialYear: z.string().nullable().optional(),
  tags: z.string().nullable().optional(),
  goalId: z.string().nullable().optional(),
  isPrivate: z.boolean().optional(),
  isStandalone: z.boolean().optional(),
  weight: weightSchema,
  description: z.string().nullable().optional(),
  employeeId: z.string().nullable().optional(),
  employeeIds: z.array(z.string()).optional(),
  dependency: dependencySchema.nullable().optional(),
  isDependencyOf: z.string().nullable().optional(),
  status: taskStatusSchema.optional(),
  progress: progressSchema,
}).passthrough();

export const updateTaskSchema = z.object({
  title: z.string().min(1, "Task title is required").optional(),
  priority: z.string().nullable().optional(),
  startDate: z.string().nullable().optional(),
  dueDate: z.string().nullable().optional(),
  actualStartDate: z.string().nullable().optional(),
  actualCompletionDate: z.string().nullable().optional(),
  financialYear: z.string().nullable().optional(),
  tags: z.string().nullable().optional(),
  goalId: z.string().nullable().optional(),
  isPrivate: z.boolean().optional(),
  isStandalone: z.boolean().optional(),
  weight: weightSchema,
  description: z.string().nullable().optional(),
  employeeId: z.string().nullable().optional(),
  dependency: dependencySchema.nullable().optional(),
  isDependencyOf: z.string().nullable().optional(),
  status: taskStatusSchema.optional(),
  progress: progressSchema,
}).passthrough();

export const createTaskCommentSchema = z.object({
  comment: z.string().max(2000, "Comment cannot exceed 2000 characters").optional().default(''),
}).passthrough();

export const updateTaskStatusSchema = z.object({
  status: taskStatusSchema,
  progress: progressSchema,
});

export const taskIdParamSchema = z.object({
  id: z.string().min(1),
});

export const listTasksQuerySchema = z.object({
  // 'all' is a real accepted value (elevated/manager tenant-wide view), so
  // this stays a bounded string rather than a cuid-shaped check.
  employeeId: z.string().max(100).optional(),
  fy: z.string().max(20).optional(),
});

export const taskCommentParamSchema = z.object({
  id: z.string().min(1),
  cid: z.string().min(1),
});

export const taskCommentAttachmentParamSchema = z.object({
  id: z.string().min(1),
  cid: z.string().min(1),
  aid: z.string().min(1),
});

export const listTaskCommentsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
});

export const taskCommentAttachmentQuerySchema = z.object({
  download: z.enum(['true', 'false']).optional(),
});

