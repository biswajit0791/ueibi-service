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


/**
 * A manager's adjustment to the credit earned for a task.
 *
 * `managerFinalWeight: null` clears the adjustment and lets the calculated
 * earned credit stand again. The upper bound is checked in the controller,
 * because it depends on the task's own planned weight.
 */
export const finalWeightSchema = z.object({
  managerFinalWeight: z.preprocess(
    (v) => (v === undefined || v === null || v === '' ? v : Math.round(Number(v))),
    z.number().int().min(0).max(100).nullable(),
  ),
  reason: z.string().max(500).nullish(),
}).passthrough();

/**
 * Filters for the weightage ledger.
 *
 * `from`/`to` are a real date range — month, year or an arbitrary window like
 * 10-20 Sept. They are the reliable filter: `financialYear` on a task is a
 * free-text string that in live data is variously "FY 2026-27", "all" or null,
 * so filtering on it alone silently hides work.
 */
export const teamWeightageQuerySchema = z.object({
  fy: z.string().max(20).optional(),
  from: z.string().max(40).optional(),
  to: z.string().max(40).optional(),
  page: z.coerce.number().int().min(1).optional(),
  // `limit=0` means "every matching row" — what an export needs. Bounded at
  // 500 otherwise so a page request cannot ask for an unbounded result set.
  limit: z.coerce.number().int().min(0).max(500).optional(),
});
