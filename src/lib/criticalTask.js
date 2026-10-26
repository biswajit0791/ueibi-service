/**
 * criticalTask.js
 *
 * Pure rules for critical-priority tasks, kept free of Prisma/Express so they
 * can be unit tested directly (tests/unit/criticalTask.test.js).
 */
import { createMilestoneSchema, MAX_MILESTONES_PER_TASK } from '../validations/taskMilestone.schema.js';

export const MIN_CRITICAL_MILESTONES = 1;
export const MAX_CRITICAL_MILESTONES = MAX_MILESTONES_PER_TASK;

export const isCriticalPriority = (priority) => String(priority || '').toLowerCase() === 'critical';

const startOfDay = (value) => {
  const d = new Date(value);
  d.setHours(0, 0, 0, 0);
  return d;
};

/**
 * Validates the milestone boxes submitted together with a critical task.
 * Mirrors the per-milestone rules in taskMilestone.controller.js#createMilestone
 * so a task cannot be created with milestones that could not be added later.
 *
 * Returns `{ items }` (normalised, ordered 1..n) or `{ error }`.
 */
export function validateMilestoneDrafts(drafts, { startDate, dueDate, now = new Date() } = {}) {
  if (!Array.isArray(drafts) || drafts.length < MIN_CRITICAL_MILESTONES) {
    return { error: `A critical task needs at least ${MIN_CRITICAL_MILESTONES} milestone` };
  }
  if (drafts.length > MAX_CRITICAL_MILESTONES) {
    return { error: `A critical task may have at most ${MAX_CRITICAL_MILESTONES} milestones` };
  }
  if (!dueDate) {
    return { error: 'The task needs its own due date before milestones can be added' };
  }

  const taskDue = new Date(dueDate);
  if (Number.isNaN(taskDue.getTime())) return { error: 'Invalid task due date' };
  const taskStart = startDate ? startOfDay(startDate) : null;
  const today = startOfDay(now);
  const isTaskOverdue = startOfDay(taskDue) < today;

  const items = [];
  for (let i = 0; i < drafts.length; i += 1) {
    const label = `Milestone ${i + 1}`;
    const parsed = createMilestoneSchema.safeParse(drafts[i]);
    if (!parsed.success) {
      return { error: `${label}: ${parsed.error.issues[0]?.message || 'is invalid'}` };
    }
    const data = parsed.data;
    const due = new Date(data.dueDate);
    if (Number.isNaN(due.getTime())) return { error: `${label}: invalid due date` };

    const dueMidnight = startOfDay(due);
    if (taskStart) {
      if (dueMidnight < taskStart) {
        return { error: `${label}: due date cannot be earlier than the task's start date` };
      }
    } else if (!isTaskOverdue && dueMidnight < today) {
      return { error: `${label}: due date cannot be in the past` };
    }
    if (due > taskDue) {
      return { error: `${label}: due date cannot be later than the task's own due date` };
    }

    items.push({
      order: i + 1,
      title: data.title.trim(),
      description: data.description?.trim() || null,
      dueDate: due,
      progress: Number(data.progress || 0),
      watcherEmails: data.watcherEmails,
      assigneeId: data.assigneeId || null,
    });
  }
  return { items };
}
