import { prisma } from '../lib/prisma.js';
import { computeCycleRollup, buildEmployeeWhere } from './reportAggregation.service.js';

/**
 * @file reportExport.service.js
 * @description Row builders for the Performance Reports exports, plus CSV
 * serialisation.
 *
 * Every report here is derived from real records (PerformanceReview,
 * ReviewScore, Goal/GoalAssignment, PeerNomination/PeerFeedback, Task,
 * TaskMilestone, LeaveRequest, ExitDetails, TenantUser). Nothing is
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
const isoDate = (d) => (d ? new Date(d).toISOString().split('T')[0] : '');
const yesNo = (b) => (b ? 'Yes' : 'No');

/** Mean of the non-null values of one score column across a review's parameters. */
function meanScore(scores, key) {
  const vals = scores.map((s) => s[key]).filter((v) => v != null);
  if (vals.length === 0) return null;
  return Number((vals.reduce((a, v) => a + v, 0) / vals.length).toFixed(1));
}

/** Per-employee goal completion % for a financial year ("FY 2026-27"). */
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
      reviewType: true, status: true, dueDate: true, selfRating: true, managerRating: true,
      hikePercentage: true, hrSignoffStatus: true, hrSignedOffAt: true,
      selfSubmittedAt: true, managerSubmittedAt: true, finalisedAt: true,
      workScore: true, averageManagerRating: true, hrRating: true,
      employee: { select: { employeeId: true, name: true, email: true, department: true, designation: true } },
      scores: { select: { selfScore: true, managerScore: true, hrScore: true } },
    },
    orderBy: { createdAt: 'asc' },
  });
  if (countOnly) return { count: reviews.length };

  return {
    headers: ['Employee ID', 'Employee', 'Email', 'Department', 'Designation', 'Cycle', 'Review Type',
      'Review Status', 'Avg Self Score', 'Avg Manager Score', 'Avg HR Score', 'Overall Self Rating',
      'Overall Manager Rating', 'Task Manager Rating', 'Work Score (Final Weightage)', 'HR Rating',
      'Hike %', 'HR Stage', 'Self Submitted', 'Manager Submitted', 'Finalised'],
    rows: reviews.map((r) => [
      r.employee?.employeeId || '', r.employee?.name || '', r.employee?.email || '',
      r.employee?.department || 'Unassigned', r.employee?.designation || '',
      cycle.name, r.reviewType, r.status,
      num(meanScore(r.scores, 'selfScore')), num(meanScore(r.scores, 'managerScore')), num(meanScore(r.scores, 'hrScore')),
      num(r.selfRating), num(r.managerRating),
      num(r.averageManagerRating), num(r.workScore), num(r.hrRating),
      // Hikes only exist on annual reviews.
      r.reviewType === 'ANNUAL' ? num(r.hikePercentage) : '',
      r.hrSignoffStatus,
      r.selfSubmittedAt ? r.selfSubmittedAt.toISOString() : '',
      r.managerSubmittedAt ? r.managerSubmittedAt.toISOString() : '',
      r.finalisedAt ? r.finalisedAt.toISOString() : '',
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

async function goalCompletion({ tenantId, fy, department, countOnly }) {
  const { goals } = await getGoalCompletionByEmployee(tenantId, fy?.label);

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
async function performanceGoalMatrix({ tenantId, cycle, fy, department, countOnly }) {
  const employees = await prisma.tenantUser.findMany({
    where: buildEmployeeWhere(tenantId, department),
    select: { id: true, name: true, email: true, department: true, designation: true },
    orderBy: { name: 'asc' },
  });
  if (countOnly) return { count: employees.length };

  const [{ byEmployee }, reviews] = await Promise.all([
    getGoalCompletionByEmployee(tenantId, fy?.label),
    cycle
      ? prisma.performanceReview.findMany({
          where: { cycleId: cycle.id },
          select: {
            employeeId: true, managerRating: true, averageManagerRating: true, status: true,
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
      const fallback = rev?.averageManagerRating ?? rev?.managerRating;
      const managerScore = rev ? (meanScore(rev.scores, 'managerScore') ?? (fallback != null ? Number(fallback) : null)) : null;
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

/** Current workforce: every active or invited (not yet onboarded) employee. */
async function headcount({ tenantId, department, countOnly }) {
  const where = {
    tenantId,
    isDeleted: false,
    status: { in: ['ACTIVE', 'INVITED'] },
    ...(department ? { department } : {}),
  };
  if (countOnly) return { count: await prisma.tenantUser.count({ where }) };

  const employees = await prisma.tenantUser.findMany({
    where,
    select: {
      employeeId: true, name: true, email: true, phone: true, role: true, status: true,
      department: true, designation: true, band: true, empType: true, officeLocation: true, joinDate: true,
      manager: { select: { name: true } },
    },
    orderBy: [{ department: 'asc' }, { name: 'asc' }],
  });

  return {
    headers: ['Employee ID', 'Employee', 'Email', 'Phone', 'Role', 'Status', 'Department', 'Designation',
      'Band', 'Employment Type', 'Location', 'Reporting Manager', 'Join Date'],
    rows: employees.map((e) => [
      e.employeeId || '', e.name, e.email, e.phone || '', e.role, e.status,
      e.department || 'Unassigned', e.designation || '', e.band || '', e.empType,
      e.officeLocation || '', e.manager?.name || '', isoDate(e.joinDate),
    ]),
  };
}

/**
 * Tasks for the financial year with their milestone progress. A task belongs to
 * the year it is tagged with; untagged (older) tasks fall back to their due date.
 * Private tasks are personal to-dos and stay out of the report.
 */
async function taskStatus({ tenantId, fy, department, countOnly }) {
  if (!fy) return countOnly ? { count: 0 } : { headers: [], rows: [] };
  const where = {
    tenantId,
    isPrivate: false,
    OR: [
      { financialYear: fy.label },
      { financialYear: null, dueDate: { gte: fy.startDate, lte: fy.endDate } },
    ],
    ...(department ? { employee: { department } } : {}),
  };
  if (countOnly) return { count: await prisma.task.count({ where }) };

  const tasks = await prisma.task.findMany({
    where,
    select: {
      title: true, priority: true, status: true, progress: true, weight: true,
      startDate: true, dueDate: true, actualCompletionDate: true, managerRating: true, financialYear: true,
      employee: { select: { name: true, email: true, department: true } },
      goal: { select: { title: true } },
      milestones: { select: { isDone: true } },
    },
    orderBy: [{ dueDate: 'asc' }, { createdAt: 'asc' }],
  });
  const now = new Date();

  return {
    headers: ['Task', 'Owner', 'Owner Email', 'Department', 'Goal', 'Priority', 'Status', 'Progress %',
      'Weight %', 'Start Date', 'Due Date', 'Completed On', 'Overdue', 'Milestones Done', 'Milestones Total',
      'Manager Rating', 'Financial Year'],
    rows: tasks.map((t) => [
      t.title, t.employee?.name || '', t.employee?.email || '', t.employee?.department || 'Unassigned',
      t.goal?.title || 'Standalone', t.priority || '', t.status, t.progress, t.weight,
      isoDate(t.startDate), isoDate(t.dueDate), isoDate(t.actualCompletionDate),
      yesNo(t.status !== 'done' && t.dueDate && t.dueDate < now),
      t.milestones.filter((m) => m.isDone).length, t.milestones.length,
      num(t.managerRating), t.financialYear || fy.label,
    ]),
  };
}

/** Leave and WFH requests that start inside the financial year. */
async function leaveSummary({ tenantId, fy, department, countOnly }) {
  if (!fy) return countOnly ? { count: 0 } : { headers: [], rows: [] };
  const where = {
    startDate: { gte: fy.startDate, lte: fy.endDate },
    // LeaveRequest.tenantId is nullable on legacy rows; the employee's tenant is authoritative.
    employee: { tenantId, ...(department ? { department } : {}) },
  };
  if (countOnly) return { count: await prisma.leaveRequest.count({ where }) };

  const leaves = await prisma.leaveRequest.findMany({
    where,
    select: {
      type: true, requestType: true, startDate: true, endDate: true, totalDays: true, dayType: true,
      status: true, managerStatus: true, createdAt: true,
      leaveType: { select: { name: true } },
      employee: { select: { employeeId: true, name: true, email: true, department: true } },
    },
    orderBy: { startDate: 'asc' },
  });

  return {
    headers: ['Employee ID', 'Employee', 'Email', 'Department', 'Request Type', 'Leave Type', 'From', 'To',
      'Days', 'Day Type', 'Status', 'Manager Status', 'Applied On'],
    rows: leaves.map((l) => [
      l.employee?.employeeId || '', l.employee?.name || '', l.employee?.email || '',
      l.employee?.department || 'Unassigned', l.requestType, l.leaveType?.name || l.type,
      isoDate(l.startDate), isoDate(l.endDate), l.totalDays, l.dayType, l.status, l.managerStatus,
      isoDate(l.createdAt),
    ]),
  };
}

/** Exits whose last working day falls inside the financial year, with clearance progress. */
async function exitReport({ tenantId, fy, department, countOnly }) {
  if (!fy) return countOnly ? { count: 0 } : { headers: [], rows: [] };
  const where = {
    tenantId,
    lastWorkingDay: { gte: fy.startDate, lte: fy.endDate },
    ...(department ? { user: { department } } : {}),
  };
  if (countOnly) return { count: await prisma.exitDetails.count({ where }) };

  const exits = await prisma.exitDetails.findMany({
    where,
    select: {
      resignationDate: true, lastWorkingDay: true, exitReason: true, exitStatus: true, noticePeriodDays: true,
      settlementStatus: true, exitInterviewDate: true,
      user: { select: { employeeId: true, name: true, email: true, department: true, designation: true, joinDate: true } },
      clearances: { select: { status: true } },
    },
    orderBy: { lastWorkingDay: 'asc' },
  });

  return {
    headers: ['Employee ID', 'Employee', 'Email', 'Department', 'Designation', 'Join Date', 'Resignation Date',
      'Last Working Day', 'Notice Period (days)', 'Exit Reason', 'Exit Status', 'Exit Interview',
      'Clearances Done', 'Clearances Total', 'Settlement'],
    rows: exits.map((x) => [
      x.user?.employeeId || '', x.user?.name || '', x.user?.email || '', x.user?.department || 'Unassigned',
      x.user?.designation || '', isoDate(x.user?.joinDate), isoDate(x.resignationDate), isoDate(x.lastWorkingDay),
      num(x.noticePeriodDays), x.exitReason, x.exitStatus, isoDate(x.exitInterviewDate),
      x.clearances.filter((c) => c.status === 'CLEARED').length, x.clearances.length, x.settlementStatus,
    ]),
  };
}

const BUILDERS = {
  'appraisal-summary': appraisalSummary,
  'department-summary': departmentSummary,
  'goal-completion': goalCompletion,
  'peer-feedback-audit': peerFeedbackAudit,
  'performance-goal-matrix': performanceGoalMatrix,
  headcount,
  'task-status': taskStatus,
  'leave-summary': leaveSummary,
  'exit-report': exitReport,
};

// `group` drives the sections on the Reports page; `scope` says which filter
// the rows follow: the selected appraisal cycle, the financial year, or now.
export const REPORT_CATALOG = [
  { key: 'appraisal-summary', group: 'Appraisals', name: 'Appraisal Summary', description: 'Per-employee review status, self/manager/HR scores, task-based manager rating, work score, hike % (annual) and HR stage for the selected cycle.', scope: 'cycle' },
  { key: 'department-summary', group: 'Appraisals', name: 'Department Performance Summary', description: 'Per-department headcount, review completion and average appraisal scores.', scope: 'cycle' },
  { key: 'peer-feedback-audit', group: 'Appraisals', name: '360 Feedback Audit', description: 'Peer nomination participation and submitted peer ratings.', scope: 'cycle' },
  { key: 'performance-goal-matrix', group: 'Appraisals', name: 'Performance vs Goal Completion Matrix', description: 'Manager appraisal rating against goal completion for the financial year, per active employee.', scope: 'cycle' },
  { key: 'goal-completion', group: 'Goals & Tasks', name: 'Goal Completion Report', description: 'Every goal for the financial year with owner, status and progress.', scope: 'financialYear' },
  { key: 'task-status', group: 'Goals & Tasks', name: 'Task & Milestone Status', description: 'Tasks for the financial year with goal, status, weight, due dates, overdue flag, milestones and manager rating.', scope: 'financialYear' },
  { key: 'headcount', group: 'People', name: 'Headcount & Employee Directory', description: 'Active and invited employees with department, designation, band, manager and join date.', scope: 'current' },
  { key: 'leave-summary', group: 'People', name: 'Leave & WFH Report', description: 'Leave and WFH requests starting in the financial year, with days and approval status.', scope: 'financialYear' },
  { key: 'exit-report', group: 'People', name: 'Exit & Attrition Report', description: 'Employees whose last working day falls in the financial year, with reason, exit stage and clearance progress.', scope: 'financialYear' },
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
