import { prisma } from '../lib/prisma.js';
import { toGoalsFinancialYear } from '../lib/financialYear.js';
import { computeCycleRollup, buildEmployeeWhere } from './reportAggregation.service.js';

/**
 * @file reportExport.service.js
 * @description Row builders for the Performance Reports exports, plus CSV
 * serialisation.
 *
 * Every report here is derived from real records (PerformanceReview,
 * ReviewScore, Goal/GoalAssignment, PeerNomination/PeerFeedback). Nothing is
 * synthesised — where a value genuinely doesn't exist it is emitted blank
 * rather than filled with a plausible-looking default.
 */

// ── CSV serialisation ───────────────────────────────────────────────────────
// Follows the established pattern in policy.service.js (RFC-4180 quoting, CRLF
// terminators), with two additions: a UTF-8 BOM so Excel renders non-ASCII
// names correctly, and neutralising of leading =/+/-/@ so a spreadsheet does
// not execute user-entered text (names, feedback) as a formula.
function escapeCsv(value) {
  if (value === null || value === undefined) return '""';
  let str = value instanceof Date ? value.toISOString() : String(value);
  if (/^[=+\-@\t\r]/.test(str)) str = `'${str}`;
  return `"${str.replace(/"/g, '""')}"`;
}

export function toCsv(headers, rows) {
  const body = rows.map((r) => r.map(escapeCsv).join(','));
  return `\uFEFF${[headers.map(escapeCsv).join(','), ...body].join('\r\n')}`;
}

const num = (v) => (v === null || v === undefined ? '' : Number(v));

/** Mean of the non-null values of one score column across a review's parameters. */
function meanScore(scores, key) {
  const vals = scores.map((s) => s[key]).filter((v) => v != null);
  if (vals.length === 0) return null;
  return Number((vals.reduce((a, v) => a + v, 0) / vals.length).toFixed(1));
}

/** Per-employee goal completion % for a financial year (2-digit Goal form). */
async function getGoalCompletionByEmployee(tenantId, goalsFy) {
  const goals = await prisma.goal.findMany({
    where: { tenantId, ...(goalsFy ? { financialYear: goalsFy } : {}) },
    select: {
      id: true, title: true, status: true, progress: true, financialYear: true,
      employeeId: true,
      employee: { select: { id: true, name: true, email: true, department: true } },
      assignments: {
        select: {
          progress: true, status: true,
          employee: { select: { id: true, name: true, email: true, department: true } },
        },
      },
    },
  });

  // A goal counts for its primary assignee and for every GoalAssignment row;
  // per-employee progress prefers the assignment (team.controller.js precedent).
  const byEmployee = new Map();
  const bump = (emp, progress, status) => {
    if (!emp) return;
    if (!byEmployee.has(emp.id)) {
      byEmployee.set(emp.id, { employee: emp, total: 0, completed: 0, progressSum: 0 });
    }
    const b = byEmployee.get(emp.id);
    b.total += 1;
    b.progressSum += Number(progress) || 0;
    if (String(status).toUpperCase() === 'COMPLETED') b.completed += 1;
  };

  for (const g of goals) {
    const assignmentEmployeeIds = new Set(g.assignments.map((a) => a.employee?.id).filter(Boolean));
    if (g.employee && !assignmentEmployeeIds.has(g.employee.id)) {
      bump(g.employee, g.progress, g.status);
    }
    for (const a of g.assignments) bump(a.employee, a.progress, a.status);
  }

  return { goals, byEmployee };
}

// ── Report builders ─────────────────────────────────────────────────────────
// Each returns { headers, rows, fileName } — or { count } when only counting.

async function appraisalSummary({ tenantId, cycle, department, countOnly }) {
  if (!cycle) return countOnly ? { count: 0 } : { headers: [], rows: [] };
  const reviews = await prisma.performanceReview.findMany({
    where: { cycleId: cycle.id, ...(department ? { employee: { department } } : {}) },
    select: {
      status: true, dueDate: true, selfRating: true, managerRating: true,
      hikePercentage: true, hrSignoffStatus: true, hrSignedOffAt: true,
      selfSubmittedAt: true, managerSubmittedAt: true,
      employee: { select: { name: true, email: true, department: true, designation: true } },
      scores: { select: { selfScore: true, managerScore: true, hrScore: true } },
    },
    orderBy: { createdAt: 'asc' },
  });
  if (countOnly) return { count: reviews.length };

  return {
    headers: ['Employee', 'Email', 'Department', 'Designation', 'Cycle', 'Review Status',
      'Avg Self Score', 'Avg Manager Score', 'Avg HR Score', 'Overall Self Rating',
      'Overall Manager Rating', 'Hike %', 'HR Sign-off', 'Self Submitted', 'Manager Submitted'],
    rows: reviews.map((r) => [
      r.employee?.name || '', r.employee?.email || '',
      r.employee?.department || 'Unassigned', r.employee?.designation || '',
      cycle.name, r.status,
      num(meanScore(r.scores, 'selfScore')), num(meanScore(r.scores, 'managerScore')), num(meanScore(r.scores, 'hrScore')),
      num(r.selfRating), num(r.managerRating), num(r.hikePercentage),
      r.hrSignoffStatus,
      r.selfSubmittedAt ? r.selfSubmittedAt.toISOString() : '',
      r.managerSubmittedAt ? r.managerSubmittedAt.toISOString() : '',
    ]),
  };
}

async function departmentSummary({ tenantId, cycle, department, countOnly }) {
  if (!cycle) return countOnly ? { count: 0 } : { headers: [], rows: [] };
  const rollup = await computeCycleRollup({ tenantId, cycleId: cycle.id, department });
  if (countOnly) return { count: rollup.departmentBreakdown.length };

  return {
    headers: ['Department', 'Active Headcount', 'Reviews Completed', 'Completion %',
      'Avg Self Score', 'Avg Manager Score', 'Avg HR Score'],
    rows: rollup.departmentBreakdown.map((d) => [
      d.department, d.total, d.completed, d.completionRate,
      num(d.avgSelfScore), num(d.avgManagerScore), num(d.avgHrScore),
    ]),
  };
}

async function goalCompletion({ tenantId, financialYear, department, countOnly }) {
  const goalsFy = financialYear ? toGoalsFinancialYear(financialYear) : undefined;
  const { goals } = await getGoalCompletionByEmployee(tenantId, goalsFy);

  const filtered = department
    ? goals.filter((g) => (g.employee?.department || '') === department
        || g.assignments.some((a) => (a.employee?.department || '') === department))
    : goals;
  if (countOnly) return { count: filtered.length };

  return {
    headers: ['Goal', 'Owner', 'Owner Email', 'Department', 'Status', 'Progress %',
      'Financial Year', 'Additional Assignees'],
    rows: filtered.map((g) => [
      g.title,
      g.employee?.name || '', g.employee?.email || '',
      g.employee?.department || 'Unassigned',
      g.status, g.progress, g.financialYear || '',
      g.assignments.map((a) => a.employee?.name).filter(Boolean).join('; '),
    ]),
  };
}

async function peerFeedbackAudit({ tenantId, cycle, department, countOnly }) {
  const nominations = await prisma.peerNomination.findMany({
    where: {
      tenantId,
      ...(cycle ? { cycleId: cycle.id } : {}),
      ...(department ? { reviewee: { department } } : {}),
    },
    select: {
      status: true, createdAt: true,
      reviewee: { select: { name: true, email: true, department: true } },
      reviewer: { select: { name: true, email: true } },
      feedback: { select: { rating: true, createdAt: true } },
      cycle: { select: { name: true } },
    },
    orderBy: { createdAt: 'asc' },
  });
  if (countOnly) return { count: nominations.length };

  return {
    headers: ['Reviewee', 'Reviewee Email', 'Department', 'Reviewer', 'Reviewer Email',
      'Cycle', 'Nomination Status', 'Peer Rating', 'Nominated On', 'Feedback Submitted On'],
    rows: nominations.map((n) => [
      n.reviewee?.name || '', n.reviewee?.email || '',
      n.reviewee?.department || 'Unassigned',
      n.reviewer?.name || '', n.reviewer?.email || '',
      n.cycle?.name || '', n.status,
      num(n.feedback?.rating ?? null),
      n.createdAt.toISOString(),
      n.feedback?.createdAt ? n.feedback.createdAt.toISOString() : '',
    ]),
  };
}

/**
 * Replaces the old "9-Box Grid" — which plotted performance vs *potential*, a
 * rating this schema has no field for. Both axes here are real: manager
 * appraisal rating, and actual goal completion for the matching financial year.
 */
async function performanceGoalMatrix({ tenantId, cycle, financialYear, department, countOnly }) {
  const employees = await prisma.tenantUser.findMany({
    where: buildEmployeeWhere(tenantId, department),
    select: { id: true, name: true, email: true, department: true, designation: true },
    orderBy: { name: 'asc' },
  });
  if (countOnly) return { count: employees.length };

  const goalsFy = financialYear ? toGoalsFinancialYear(financialYear) : undefined;
  const [{ byEmployee }, reviews] = await Promise.all([
    getGoalCompletionByEmployee(tenantId, goalsFy),
    cycle
      ? prisma.performanceReview.findMany({
          where: { cycleId: cycle.id },
          select: {
            employeeId: true, managerRating: true, status: true,
            scores: { select: { managerScore: true } },
          },
        })
      : Promise.resolve([]),
  ]);

  const reviewByEmployee = new Map(reviews.map((r) => [r.employeeId, r]));

  return {
    headers: ['Employee', 'Email', 'Department', 'Designation', 'Cycle',
      'Manager Rating (1-5)', 'Review Status', 'Goals', 'Goals Completed', 'Goal Completion %'],
    rows: employees.map((e) => {
      const rev = reviewByEmployee.get(e.id);
      const managerScore = rev ? (meanScore(rev.scores, 'managerScore') ?? (rev.managerRating != null ? Number(rev.managerRating) : null)) : null;
      const g = byEmployee.get(e.id);
      const completionPct = g && g.total > 0 ? Number(((g.completed / g.total) * 100).toFixed(1)) : '';
      return [
        e.name, e.email, e.department || 'Unassigned', e.designation || '',
        cycle?.name || '',
        num(managerScore), rev?.status || 'No review',
        g?.total ?? 0, g?.completed ?? 0, completionPct,
      ];
    }),
  };
}

const BUILDERS = {
  'appraisal-summary': appraisalSummary,
  'department-summary': departmentSummary,
  'goal-completion': goalCompletion,
  'peer-feedback-audit': peerFeedbackAudit,
  'performance-goal-matrix': performanceGoalMatrix,
};

export const REPORT_CATALOG = [
  { key: 'appraisal-summary', name: 'Appraisal Summary', description: 'Per-employee review status, self/manager/HR averages, hike % and sign-off for the selected cycle.', scope: 'cycle' },
  { key: 'department-summary', name: 'Department Performance Summary', description: 'Per-department headcount, review completion and average appraisal scores.', scope: 'cycle' },
  { key: 'goal-completion', name: 'Goal Completion Report', description: 'Every goal for the financial year with owner, status and progress.', scope: 'financialYear' },
  { key: 'peer-feedback-audit', name: '360 Feedback Audit', description: 'Peer nomination participation and submitted peer ratings.', scope: 'cycle' },
  { key: 'performance-goal-matrix', name: 'Performance vs Goal Completion Matrix', description: 'Manager appraisal rating plotted against real goal completion (replaces the 9-box grid, which needs a potential rating this system does not capture).', scope: 'cycle+financialYear' },
];

export async function buildReport(reportKey, args) {
  const builder = BUILDERS[reportKey];
  if (!builder) throw { status: 400, message: `Unknown report: ${reportKey}` };
  return builder(args);
}

export async function countReportRows(reportKey, args) {
  const builder = BUILDERS[reportKey];
  if (!builder) return 0;
  const res = await builder({ ...args, countOnly: true });
  return res.count ?? 0;
}
