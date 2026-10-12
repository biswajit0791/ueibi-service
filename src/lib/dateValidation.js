/**
 * dateValidation.js
 *
 * Centralized backend date validation utility for Karyam HRMS API services.
 */
import { prisma } from './prisma.js';

export function toDateOnlyString(d) {
  if (!d) return null;
  if (typeof d === 'string') {
    if (/^\d{4}-\d{2}-\d{2}$/.test(d)) return d;
    if (d.includes('T')) return d.split('T')[0];
    const parsed = new Date(d);
    if (!isNaN(parsed.getTime())) {
      const year = parsed.getFullYear();
      const month = String(parsed.getMonth() + 1).padStart(2, '0');
      const day = String(parsed.getDate()).padStart(2, '0');
      return `${year}-${month}-${day}`;
    }
    return d.slice(0, 10);
  }
  if (d instanceof Date && !isNaN(d.getTime())) {
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }
  return null;
}

export function validateDateRange(startDate, endDate, {
  labelStart = 'Start Date',
  labelEnd = 'Due Date',
  allowEqual = true,
} = {}) {
  const startStr = toDateOnlyString(startDate);
  const endStr = toDateOnlyString(endDate);

  if (!startStr || !endStr) return { isValid: true, error: null };

  if (allowEqual ? startStr > endStr : startStr >= endStr) {
    return {
      isValid: false,
      error: allowEqual
        ? `${labelEnd} cannot be earlier than ${labelStart}`
        : `${labelEnd} must be after ${labelStart}`,
    };
  }

  return { isValid: true, error: null };
}

/**
 * Revalidates all checkpoints associated with a task when the task's dates are changed.
 * Prevents invalid states where a task is moved outside existing milestone checkpoint schedules.
 */
export async function assertTaskDatesFitMilestones(taskId, newStartDate, newDueDate) {
  const milestones = await prisma.taskMilestone.findMany({
    where: { taskId },
    orderBy: { order: 'asc' },
  });

  if (!milestones || milestones.length === 0) return;

  const startStr = toDateOnlyString(newStartDate);
  const dueStr = toDateOnlyString(newDueDate);

  for (const m of milestones) {
    const mDueStr = toDateOnlyString(m.dueDate);
    if (!mDueStr) continue;

    if (startStr && mDueStr < startStr) {
      throw {
        status: 400,
        message: `Cannot set task start date to ${startStr}: Station 0${m.order} ("${m.title}") is scheduled for ${mDueStr}, which is earlier than the new start date.`,
      };
    }

    if (dueStr && mDueStr > dueStr) {
      throw {
        status: 400,
        message: `Cannot set task due date to ${dueStr}: Station 0${m.order} ("${m.title}") is scheduled for ${mDueStr}, which is later than the new due date.`,
      };
    }
  }
}
