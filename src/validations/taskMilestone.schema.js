import { z } from 'zod';

export const MAX_MILESTONES_PER_TASK = 3;
export const MAX_WATCHERS_PER_MILESTONE = 10;

const watcherEmailsBaseSchema = z
  .array(z.string().trim().email('Each watcher must be a valid email address'))
  .max(MAX_WATCHERS_PER_MILESTONE, `A milestone may have at most ${MAX_WATCHERS_PER_MILESTONE} watchers`);

export const createMilestoneSchema = z.object({
  title: z.string().trim().min(1, 'Checkpoint title is required').max(300),
  description: z.string().trim().max(2000).optional().default(''),
  dueDate: z.string({ required_error: 'Checkpoint due date is required' }),
  progress: z.number().int().min(0).max(100).optional().default(0),
  watcherEmails: watcherEmailsBaseSchema.optional().default([]),
});

// One endpoint, several distinct actions — see taskMilestone.controller.js for
// which role each one requires. All fields are optional; the controller
// looks at which ones were actually sent to decide what is being asked.
export const updateMilestoneSchema = z.object({
  title: z.string().trim().min(1).max(300).optional(),
  description: z.string().trim().max(2000).optional(),
  dueDate: z.string().optional(),
  progress: z.number().int().min(0).max(100).optional(),
  watcherEmails: watcherEmailsBaseSchema.optional(),
  // Employee proposes a new completion date or extension days.
  proposedCompletionDate: z.string().nullable().optional(),
  extensionDaysRequested: z.number().int().min(1).max(90).nullable().optional(),
  extensionReason: z.string().trim().max(1000).nullable().optional(),
  // Manager approves the milestone as-is, or approves the currently proposed
  // date (whichever is pending). false explicitly rejects a proposed date
  // (status becomes RESCHEDULE_REQUESTED) rather than being ignored.
  approve: z.boolean().optional(),
  isDone: z.boolean().optional(),
}).refine((data) => Object.keys(data).length > 0, {
  message: 'At least one field must be provided',
});
