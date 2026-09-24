/**
 * taskTiming.js
 *
 * Delay and overdue arithmetic for a task, from the four dates it carries:
 * the planned pair (startDate, dueDate) and the actual pair
 * (actualStartDate, actualCompletionDate).
 *
 * Pure — no database, no clock of its own. `now` is always passed in so the
 * same input gives the same answer in a test as in production.
 *
 * Tasks created before the actual-date columns existed have them null. Those
 * report `null` rather than 0: "not recorded" is not the same as "on time",
 * and a delay figure invented from updatedAt would be a guess shown to a
 * manager as a fact.
 */

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Whole days between two dates, counted from UTC midnight so that a
 *  09:00 → 17:00 pair on one day is 0 days, not a fraction that rounds. */
export function daysBetween(from, to) {
  if (!from || !to) return null;
  const a = new Date(from);
  const b = new Date(to);
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return null;
  const midnight = (d) => Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  return Math.round((midnight(b) - midnight(a)) / MS_PER_DAY);
}

/** Has work begun on this task? The two signals can disagree — a task nudged
 *  to 10% progress while still labelled 'todo' has begun — so either counts. */
export function isWorkStarted(task) {
  return String(task?.status || 'todo') !== 'todo' || Number(task?.progress || 0) > 0;
}

export function isWorkComplete(task) {
  return String(task?.status || '') === 'done' || Number(task?.progress || 0) >= 100;
}

/**
 * @returns {{
 *   startDelayDays: number|null,       // + = started later than planned
 *   completionDelayDays: number|null,  // + = finished later than due
 *   daysOverdue: number|null,          // days past due, still unfinished
 *   isStarted: boolean,
 *   isComplete: boolean,
 *   isOverdue: boolean,
 *   startedLate: boolean,
 *   finishedLate: boolean,
 *   state: 'NOT_STARTED'|'ON_TRACK'|'DUE_TODAY'|'OVERDUE'|'COMPLETED_ON_TIME'|'COMPLETED_LATE'|'COMPLETED'
 * }}
 */
export function taskTiming(task, now = new Date()) {
  const started = isWorkStarted(task);
  const complete = isWorkComplete(task);

  const startDelayDays = task?.actualStartDate && task?.startDate
    ? daysBetween(task.startDate, task.actualStartDate)
    : null;

  const completionDelayDays = task?.actualCompletionDate && task?.dueDate
    ? daysBetween(task.dueDate, task.actualCompletionDate)
    : null;

  // Only meaningful while the work is still open.
  let daysOverdue = null;
  if (!complete && task?.dueDate) {
    const d = daysBetween(task.dueDate, now);
    daysOverdue = d !== null && d > 0 ? d : 0;
  }

  const isOverdue = daysOverdue !== null && daysOverdue > 0;

  let state;
  if (complete) {
    if (completionDelayDays === null) state = 'COMPLETED';           // no actual date recorded
    else if (completionDelayDays > 0) state = 'COMPLETED_LATE';
    else state = 'COMPLETED_ON_TIME';
  } else if (isOverdue) {
    state = 'OVERDUE';
  } else if (daysOverdue === 0 && task?.dueDate && daysBetween(now, task.dueDate) === 0) {
    state = 'DUE_TODAY';
  } else if (started) {
    state = 'ON_TRACK';
  } else {
    state = 'NOT_STARTED';
  }

  return {
    startDelayDays,
    completionDelayDays,
    daysOverdue,
    isStarted: started,
    isComplete: complete,
    isOverdue,
    startedLate: startDelayDays !== null && startDelayDays > 0,
    finishedLate: completionDelayDays !== null && completionDelayDays > 0,
    state,
  };
}

/**
 * The actual-date columns to write when a task moves to `nextStatus` /
 * `nextProgress`. Returns only the fields that need to change, so it can be
 * spread straight into a Prisma `data` object.
 *
 * actualStartDate, once set, is never cleared: that a task was started on a
 * given day stays true even if it is later pushed back to 'todo'.
 * actualCompletionDate is cleared when a task stops being complete, because a
 * reopened task has not finished.
 */
export function timingUpdates(existing, next, now = new Date()) {
  const after = {
    status: next?.status !== undefined ? next.status : existing?.status,
    progress: next?.progress !== undefined ? next.progress : existing?.progress,
  };
  const data = {};

  // An explicit status wins over progress. Reopening a finished task sets the
  // status to 'in_progress' but leaves progress at 100 — that is how the task
  // endpoints have always behaved — so reading completion off progress alone
  // would keep a completion date on a task that is demonstrably open again.
  const statusGiven = next?.status !== undefined && next?.status !== null;
  const complete = statusGiven ? String(next.status) === 'done' : isWorkComplete(after);

  if (isWorkStarted(after) && !existing?.actualStartDate) {
    data.actualStartDate = now;
  }
  if (complete) {
    if (!existing?.actualCompletionDate) data.actualCompletionDate = now;
    // A task completed without ever being marked started still has a start.
    if (!existing?.actualStartDate && !data.actualStartDate) data.actualStartDate = now;
  } else if (existing?.actualCompletionDate) {
    data.actualCompletionDate = null;
  }

  return data;
}
