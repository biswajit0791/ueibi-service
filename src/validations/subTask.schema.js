import { z } from 'zod';

/**
 * Checklist items under a task.
 *
 * Note what is NOT here: no weight, no progress, no percentage. A sub-task is
 * a record of what someone is working through, and it deliberately has no say
 * in the parent task's completion figure or the goal's weight total.
 */
export const createSubTaskSchema = z.object({
  title: z.string().trim().min(1, 'Sub-task title is required').max(300, 'Sub-task title cannot exceed 300 characters'),
  assigneeId: z.string().max(100).nullish(),
  isDone: z.boolean().optional(),
  position: z.coerce.number().int().min(0).max(9999).optional(),
}).passthrough();

export const updateSubTaskSchema = z.object({
  title: z.string().trim().min(1, 'Sub-task title cannot be empty').max(300).optional(),
  assigneeId: z.string().max(100).nullish(),
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
