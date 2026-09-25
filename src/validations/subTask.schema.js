import { z } from 'zod';

/**
 * Sub-tasks: a full record of a piece of work inside a task.
 *
 * Note what is deliberately NOT here: weight. A sub-task carries title,
 * description, assignee, planned dates and actual dates — everything a task
 * has except its share of the goal. It has no say in the parent task's
 * percentage or the goal's 100% total, which is what keeps it out of the
 * execution lock.
 */
const dateish = z.string().nullish();

export const createSubTaskSchema = z.object({
  title: z.string().trim().min(1, 'Sub-task title is required').max(300, 'Sub-task title cannot exceed 300 characters'),
  description: z.string().max(5000, 'Description cannot exceed 5000 characters').nullish(),
  assigneeId: z.string().max(100).nullish(),
  startDate: dateish,
  dueDate: dateish,
  actualStartDate: dateish,
  actualCompletionDate: dateish,
  isDone: z.boolean().optional(),
  position: z.coerce.number().int().min(0).max(9999).optional(),
}).passthrough();

export const updateSubTaskSchema = z.object({
  title: z.string().trim().min(1, 'Sub-task title cannot be empty').max(300).optional(),
  description: z.string().max(5000).nullish(),
  assigneeId: z.string().max(100).nullish(),
  startDate: dateish,
  dueDate: dateish,
  actualStartDate: dateish,
  actualCompletionDate: dateish,
  isDone: z.boolean().optional(),
  position: z.coerce.number().int().min(0).max(9999).optional(),
}).passthrough();

/** Reordering the whole list in one call. */
export const reorderSubTasksSchema = z.object({
  order: z.array(z.string().min(1)).min(1).max(200),
}).passthrough();

export const subTaskParamSchema = z.object({
  id: z.string().min(1),
});

export const subTaskChildParamSchema = z.object({
  id: z.string().min(1),
  sid: z.string().min(1),
});

/**
 * The sub-task board: every sub-task on the tasks the caller can see.
 * `employeeId` accepts 'all' exactly as the task board does.
 */
export const boardSubTasksQuerySchema = z.object({
  employeeId: z.string().max(100).optional(),
  fy: z.string().max(20).optional(),
});
