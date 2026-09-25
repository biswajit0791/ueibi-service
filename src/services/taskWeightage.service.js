/**
 * taskWeightage.service.js
 *
 * The weightage ledger: what each task was worth, what was earned by
 * completing it, and what the manager finally awarded.
 *
 * THREE DIFFERENT NUMBERS live here and must not be confused:
 *
 *   plannedWeight    `Task.weight` — the task's share of its goal. Must total
 *                    exactly 100 across the goal and drives the execution
 *                    lock. NOTHING in this file writes to it.
 *   completedWeight  what the work earned: plannedWeight × progress. Derived,
 *                    never stored.
 *   finalWeight      what actually counts: the manager's adjustment when one
 *                    was made, otherwise completedWeight.
 *
 * Adjusting the final weight changes no percentage anywhere — not the task's
 * progress, not the goal's completion, not the goal's weight total, and not
 * the execution lock. That separation is the whole point: a manager can dock
 * credit for late delivery without silently re-planning the goal.
 */
import { prisma } from '../lib/prisma.js';
import { taskTiming } from '../lib/taskTiming.js';

const TASK_SELECT = {
  id: true, title: true, goalId: true, employeeId: true, status: true,
  weight: true, progress: true,
  startDate: true, dueDate: true,
  actualStartDate: true, actualCompletionDate: true,
  isDependencyOf: true, isStandalone: true, financialYear: true,
  managerFinalWeight: true, weightAdjustedAt: true, weightAdjustReason: true,
  weightAdjustedBy: { select: { id: true, name: true } },
  goal: { select: { id: true, title: true } },
  employee: { select: { id: true, name: true } },
};

/**
 * A task's financial year is free text, and live data holds three different
 * shapes of it: "FY 2026-27", "all", and null. The Goals pages write the
 * 2-digit form; the appraisal-matching pages use "FY 2026-2027". Comparing
 * them literally silently returns nothing, which is exactly what happened.
 *
 * So: match either spelling of the same year, and never let a task with "all"
 * or no financial year disappear from a ledger just because it was never
 * labelled.
 */
export function financialYearFilter(fy) {
  if (!fy || fy === 'all') return {};
  const year = String(fy).match(/(\d{4})/);
  if (!year) return { financialYear: fy };
  const start = parseInt(year[1], 10);
  return {
    OR: [
      { financialYear: `FY ${start}-${String(start + 1).slice(-2)}` },
      { financialYear: `FY ${start}-${start + 1}` },
      { financialYear: 'all' },
      { financialYear: null },
    ],
  };
}

/**
 * Which tasks fall inside a date window.
 *
 * A task belongs to the period it was DUE in; without a due date, the period
 * it started in; without either, when it was created. Chaining the fallbacks
 * means an undated task is never silently dropped from every period at once.
 */
export function dateRangeFilter(from, to) {
  if (!from && !to) return {};
  const range = {};
  if (from) {
    const d = new Date(from);
    if (!Number.isNaN(d.getTime())) range.gte = d;
  }
  if (to) {
    const d = new Date(to);
    // Inclusive of the whole closing day.
    if (!Number.isNaN(d.getTime())) range.lte = new Date(d.getTime() + 86399999);
  }
  if (!range.gte && !range.lte) return {};
  return {
    OR: [
      { dueDate: range },
      { AND: [{ dueDate: null }, { startDate: range }] },
      { AND: [{ dueDate: null }, { startDate: null }, { createdAt: range }] },
    ],
  };
}

/** Credit earned by completing the task, to the nearest whole point. */
export function completedWeightOf(task) {
  const w = Number(task.weight || 0);
  const p = Math.min(100, Math.max(0, Number(task.progress || 0)));
  return Math.round((w * p) / 100);
}

/** One row of the ledger. */
export function weightageRow(task, now = new Date()) {
  const timing = taskTiming(task, now);
  const plannedWeight = Number(task.weight || 0);
  const completedWeight = completedWeightOf(task);
  const adjusted = task.managerFinalWeight !== null && task.managerFinalWeight !== undefined;
  const finalWeight = adjusted ? Number(task.managerFinalWeight) : completedWeight;

  return {
    taskId: task.id,
    title: task.title,
    goalId: task.goalId,
    goalTitle: task.goal?.title ?? null,
    employeeId: task.employeeId,
    employeeName: task.employee?.name ?? null,
    dependentTaskId: task.isDependencyOf ?? null,
    status: task.status,
    progress: Number(task.progress || 0),
    startDate: task.startDate,
    dueDate: task.dueDate,
    actualStartDate: task.actualStartDate,
    actualCompletionDate: task.actualCompletionDate,

    plannedWeight,
    completedWeight,
    // Null until a manager actually intervenes — an untouched task is not the
    // same as one deliberately left at its earned value.
    managerFinalWeight: adjusted ? Number(task.managerFinalWeight) : null,
    finalWeight,
    isAdjusted: adjusted,
    // How much credit the adjustment removed (or added). Negative = docked.
    adjustmentDelta: adjusted ? Number(task.managerFinalWeight) - completedWeight : null,
    adjustedBy: task.weightAdjustedBy?.name ?? null,
    adjustedAt: task.weightAdjustedAt ?? null,
    adjustReason: task.weightAdjustReason ?? null,

    // Delay comes from the shared timing helper, so this ledger and the task
    // cards can never report a different number of days late.
    isDelayed: timing.finishedLate || timing.isOverdue,
    delayDays: timing.completionDelayDays !== null && timing.completionDelayDays > 0
      ? timing.completionDelayDays
      : (timing.daysOverdue || 0),
    startDelayDays: timing.startDelayDays,
    timing,
  };
}

/** The ledger for a set of tasks, with totals. */
export async function weightageFor({ tenantId, employeeId, fy, from, to, page, limit, client = prisma }) {
  const fyWhere = financialYearFilter(fy);
  const dateWhere = dateRangeFilter(from, to);
  const tasks = await client.task.findMany({
    where: {
      tenantId,
      ...(employeeId ? { employeeId } : {}),
      // Both may contribute an OR, so they are combined with AND rather than
      // spread — spreading would have one silently overwrite the other.
      ...((fyWhere.OR || dateWhere.OR)
        ? { AND: [fyWhere, dateWhere].filter((w) => Object.keys(w).length) }
        : { ...fyWhere, ...dateWhere }),
    },
    orderBy: [{ goalId: 'asc' }, { createdAt: 'asc' }],
    select: TASK_SELECT,
  });

  const allRows = tasks.map((t) => weightageRow(t));
  // Totals are computed across EVERY matching row, never just the page on
  // screen. A header that changed as you paged would be worse than useless.
  const sum = (key) => allRows.reduce((acc, r) => acc + Number(r[key] || 0), 0);

  // `limit === 0` returns everything, which is what an export asks for.
  const perPage = limit === 0 ? allRows.length : (limit || 25);
  const totalPages = perPage > 0 ? Math.max(1, Math.ceil(allRows.length / perPage)) : 1;
  const currentPage = Math.min(Math.max(1, page || 1), totalPages);
  const rows = limit === 0
    ? allRows
    : allRows.slice((currentPage - 1) * perPage, currentPage * perPage);

  return {
    rows,
    pagination: {
      page: currentPage,
      limit: perPage,
      total: allRows.length,
      totalPages,
    },
    totals: {
      taskCount: allRows.length,
      plannedWeight: sum('plannedWeight'),
      completedWeight: sum('completedWeight'),
      finalWeight: sum('finalWeight'),
      adjustedCount: allRows.filter((r) => r.isAdjusted).length,
      delayedCount: allRows.filter((r) => r.isDelayed).length,
      // What the adjustments cost in total. Negative means credit was docked.
      adjustmentDelta: allRows.reduce((a, r) => a + (r.adjustmentDelta ?? 0), 0),
    },
  };
}

export { TASK_SELECT as WEIGHTAGE_TASK_SELECT };
