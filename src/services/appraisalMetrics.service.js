/**
 * appraisalMetrics.service.js
 *
 * The Final Weightage and Manager Rating an employee sees (read-only) while
 * submitting a Monthly or Quarterly appraisal. Both come from exactly the data
 * the Team table shows — the same task-to-month rule (dateRangeFilter) and the
 * same per-employee summary (summariseByEmployee) — so the appraisal can never
 * disagree with the Team table for the same month.
 *
 *   MONTHLY    the single month's figures.
 *   QUARTERLY  the average of the three months' figures. A month with nothing
 *              to average (no completed goal task / no rating) is left out of
 *              the average rather than counted as zero.
 */
import { prisma } from '../lib/prisma.js';
import { APPRAISAL_MONTH_NAMES } from '../lib/appraisalPeriods.js';
import { summariseByEmployee, dateRangeFilter, WEIGHTAGE_TASK_SELECT } from './taskWeightage.service.js';

const round1 = (n) => Math.round(n * 10) / 10;
const pad = (n) => String(n).padStart(2, '0');
const ymd = (d) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;

/** Mean of the non-null values, to one decimal like the Team table; null when there are none. */
export function averageOfMonths(values) {
  const present = values.filter((v) => v !== null && v !== undefined && !Number.isNaN(Number(v)));
  if (present.length === 0) return null;
  return round1(present.reduce((sum, v) => sum + Number(v), 0) / present.length);
}

/**
 * The month windows a cycle covers, as { label, from, to } with inclusive
 * YYYY-MM-DD bounds (what dateRangeFilter expects): one for a monthly cycle,
 * three for a quarterly one.
 */
export function monthWindowsOf(cycle) {
  const start = new Date(cycle.startDate);
  const frequency = String(cycle.frequency).toUpperCase();
  const count = frequency === 'ANNUAL' ? 12 : frequency === 'QUARTERLY' ? 3 : 1;
  return Array.from({ length: count }, (_, i) => {
    const from = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + i, start.getUTCDate()));
    const nextFrom = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + i + 1, start.getUTCDate()));
    const to = new Date(nextFrom.getTime() - 86400000);
    return {
      label: `${APPRAISAL_MONTH_NAMES[from.getUTCMonth()]} ${from.getUTCFullYear()}`,
      from: ymd(from),
      to: ymd(to),
    };
  });
}

/**
 * Team-table Final Weightage and Manager Rating for many employees over a
 * Monthly, Quarterly or Annual cycle (annual = average of its 12 months), with one task query per month for the whole
 * group. Returns a Map employeeId → metrics (null for other frequencies).
 */
export async function getTeamTableMetricsBulk(tenantId, employeeIds, cycle) {
  const frequency = String(cycle?.frequency || '').toUpperCase();
  const result = new Map();
  if (!['MONTHLY', 'QUARTERLY', 'ANNUAL'].includes(frequency) || employeeIds.length === 0) return result;

  const windows = monthWindowsOf(cycle);
  const summaries = await Promise.all(windows.map(async (window) => {
    const tasks = await prisma.task.findMany({
      where: { AND: [{ tenantId, employeeId: { in: employeeIds } }, dateRangeFilter(window.from, window.to)] },
      select: WEIGHTAGE_TASK_SELECT,
    });
    return new Map(summariseByEmployee(tasks).map((s) => [s.employeeId, s]));
  }));

  for (const employeeId of employeeIds) {
    const months = windows.map((window, i) => {
      const summary = summaries[i].get(employeeId) || null;
      return {
        ...window,
        finalWeight: summary?.avgFinalWeight ?? null,
        managerRating: summary?.managerRating ?? null,
        completedCount: summary?.completedCount ?? 0,
        ratedCount: summary?.ratedCount ?? 0,
      };
    });
    result.set(employeeId, {
      source: 'TEAM_TABLE',
      frequency,
      cycleId: cycle.id,
      cycleName: cycle.name,
      months,
      finalWeight: frequency === 'MONTHLY' ? months[0].finalWeight : averageOfMonths(months.map((m) => m.finalWeight)),
      managerRating: frequency === 'MONTHLY' ? months[0].managerRating : averageOfMonths(months.map((m) => m.managerRating)),
    });
  }
  return result;
}

/**
 * Team-table Final Weightage and Manager Rating for one employee over a
 * Monthly or Quarterly cycle. Returns null for any other frequency.
 */
export async function getTeamTableMetrics(tenantId, employeeId, cycle) {
  return (await getTeamTableMetricsBulk(tenantId, [employeeId], cycle)).get(employeeId) || null;
}
