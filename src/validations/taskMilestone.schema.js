import { z } from 'zod';

export const MAX_MILESTONES_PER_TASK = 4;
export const MAX_WATCHERS_PER_MILESTONE = 10;

const watcherEmailsSchema = z
  .array(z.string().trim().email('Each watcher must be a valid email address'))
  .max(MAX_WATCHERS_PER_MILESTONE, `A milestone may have at most ${MAX_WATCHERS_PER_MILESTONE} watchers`)
  .optional()
  .default([]);

export const createMilestoneSchema = z.object({
  title: z.string().trim().min(1, 'Milestone title is required').max(300),
  dueDate: z.string({ required_error: 'Milestone due date is required' }),
  watcherEmails: watcherEmailsSchema,
});

// One endpoint, several distinct actions — see taskMilestone.controller.js for
// which role each one requires. All fields are optional; the controller
// looks at which ones were actually sent to decide what is being asked.
export const updateMilestoneSchema = z.object({
  title: z.string().trim().min(1).max(300).optional(),
  dueDate: z.string().optional(),
  watcherEmails: watcherEmailsSchema.optional(),
  // Employee proposes a new completion date. Null clears a pending proposal.
  proposedCompletionDate: z.string().nullable().optional(),
  // Manager approves the milestone as-is, or approves the currently proposed
  // date (whichever is pending). false explicitly rejects a proposed date
  // (status becomes RESCHEDULE_REQUESTED) rather than being ignored.
  approve: z.boolean().optional(),
  isDone: z.boolean().optional(),
}).refine((data) => Object.keys(data).length > 0, {
  message: 'At least one field must be provided',
});
