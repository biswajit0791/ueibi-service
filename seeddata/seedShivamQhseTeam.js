/**
 * @file seedShivamQhseTeam.js
 * @description Adds one more team to Shivam Housing Corporation (shovamltd.com)
 * (HR: Neha Sharma): a manager who reports to the CMD like every other team
 * manager, plus 4 employees.
 *
 * Per employee (goal owner = the new manager):
 *   FY 2025-26  Q1, Q2, Q3 goals closed and rated, 6 rated tasks each (2 a month).
 *               The "late" profile delivers some tasks late (Final Weightage cut).
 *   FY 2026-27  Oct–Dec 2026 goal, ACTIVE — the demo goal to complete live:
 *                 1 task done + rated (rating can be changed)
 *                 1 task done 6 days late + rated, weightage reduced
 *                 1 task submitted, waiting for manager approval/rating
 *                 1 task in progress, overdue (complete it late)
 *                 1 task not started, overdue (complete it late)
 *                 1 task due in December (on time)
 *
 * FY 2025-26 appraisals (monthly + quarterly):
 *   Q1  April, May, Q1          submitted and locked by HR (FINALISED)
 *   Q2  July, August, Q2        submitted, awaiting HR sign-off
 *   Q3  October, November, Q3   submitted by 2 of the 4 employees, open for the rest
 *   Q4  January, February, Q4   open for everyone
 *
 * Dry run by default. Safe to re-run (skips what already exists).
 *
 *   node seeddata/seedShivamQhseTeam.js                    # show the plan
 *   node seeddata/seedShivamQhseTeam.js --apply            # create it
 *   node seeddata/seedShivamQhseTeam.js --cleanup --apply  # remove this team and its data
 *
 * Every account signs in with the password in PASSWORD below.
 */
import 'dotenv/config';
import bcrypt from 'bcryptjs';
import { prisma } from '../src/lib/prisma.js';
import { getPeriodMetadata } from '../src/lib/appraisalPeriods.js';
import { getTeamTableMetricsBulk } from '../src/services/appraisalMetrics.service.js';

const DOMAIN = 'shovamltd.com';
const HR_EMAIL = `neha.sharma@${DOMAIN}`;
const PASSWORD = 'Test@123';
const SEED_TAG = 'seed:shivam-qhse-team';
const APPLY = process.argv.includes('--apply');
const CLEANUP = process.argv.includes('--cleanup');
const PARAMETERS = ['Technical Skills', 'Conduct & Ethics', 'Punctuality & Attendance', 'Communication', 'Teamwork & Collaboration'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

const utc = (y, m, d) => new Date(Date.UTC(y, m, d));
const addDays = (date, n) => new Date(date.getTime() + n * 86400000);
const clamp = (r) => Math.min(5, Math.max(1, r));
const halfStep = (r) => Math.round(r * 2) / 2;
const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;

const TEAM = {
  name: 'Quality, Health & Safety', department: 'Quality & Safety',
  goals: ['ISO 9001 documentation & site QA plans', 'Monsoon site safety programme', 'Zero-defect handover — Phase 1'],
  work: ['Site safety inspection', 'Concrete & material quality audit', 'Snag list verification', 'Third-party material testing', 'Toolbox talk & PPE compliance drive', 'QHSE MIS report'],
};
const MANAGER = { name: 'Sudhir Kumar Pathak', local: 'sudhir.pathak', role: 'MANAGER', designation: 'QHSE Manager', gender: 'Male', band: 'M1', employeeId: 'SHC-039' };
// submitsQ3: also submits the Oct / Nov / Q3 appraisals.
const MEMBERS = [
  { name: 'Ajay Pratap Singh', local: 'ajay.singh', designation: 'Safety Officer', gender: 'Male', profile: 'star', submitsQ3: true, employeeId: 'SHC-040' },
  { name: 'Rekha Yadav', local: 'rekha.yadav', designation: 'Quality Engineer', gender: 'Female', profile: 'solid', submitsQ3: true, employeeId: 'SHC-041' },
  { name: 'Imran Siddiqui', local: 'imran.siddiqui', designation: 'QA/QC Inspector', gender: 'Male', profile: 'avg', employeeId: 'SHC-042' },
  { name: 'Komal Srivastava', local: 'komal.srivastava', designation: 'EHS Executive', gender: 'Female', profile: 'late', employeeId: 'SHC-043' },
].map((m, i) => ({ ...m, role: 'EMPLOYEE', band: 'E2', index: 40 + i }));
const PEOPLE = [MANAGER, ...MEMBERS].map((p) => ({ ...p, email: `${p.local}@${DOMAIN}` }));

const BASE = { star: 4.5, solid: 4, avg: 3.5, late: 3 };
const WOBBLE = [0, 0.5, -0.5, 0, 0.5, 0];
const ratingFor = (p, serial) => clamp(halfStep(BASE[p.profile] + WOBBLE[(serial + p.index) % WOBBLE.length]));

const LOCKED = ['April 2025', 'May 2025', 'Q1 FY 2025-26'];
const AWAITING_HR = ['July 2025', 'August 2025', 'Q2 FY 2025-26'];
const Q3_PERIODS = ['October 2025', 'November 2025', 'Q3 FY 2025-26'];

const ACHIEVEMENTS = {
  high: 'Exceeded every target for the period, delivered all inspections and audits ahead of schedule and supported teammates on critical work.',
  mid: 'Met the targets for the period and completed all planned inspections and audits on time.',
  low: 'Completed the assigned work, though a few deliveries slipped; I am tightening my planning for the next period.',
};

// ── Main ────────────────────────────────────────────────────────────────────
async function main() {
  const hr = await prisma.tenantUser.findUnique({ where: { email: HR_EMAIL } });
  if (!hr) throw new Error(`${HR_EMAIL} not found`);
  const tenant = await prisma.tenant.findUniqueOrThrow({ where: { id: hr.tenantId } });
  console.log(`${tenant.companyName}  mode: ${CLEANUP ? 'CLEANUP ' : ''}${APPLY ? 'APPLY' : 'DRY RUN'}\n`);
  if (CLEANUP) return cleanup(tenant);

  console.log(`Team "${TEAM.name}" (HR: ${hr.name}, manager reports to the CMD)`);
  PEOPLE.forEach((p) => console.log(`  ${p.role.padEnd(9)} ${p.employeeId} ${p.name} <${p.email}>${p.profile ? `  ${p.profile}` : ''}`));
  console.log('\nGoals per employee: FY 2025-26 Q1–Q3 closed + Oct–Dec 2026 active (demo).');
  console.log(`Appraisals: locked ${LOCKED.join(', ')}; awaiting HR ${AWAITING_HR.join(', ')}; ${Q3_PERIODS.join(', ')} by ${MEMBERS.filter((m) => m.submitsQ3).map((m) => m.name).join(' & ')}.`);
  if (!APPLY) return console.log('\nDry run — nothing written. Re-run with --apply.');

  const ids = await upsertUsers(tenant, hr);
  const owner = { id: ids[MANAGER.local], name: MANAGER.name, email: MANAGER.email };
  const counts = { goals: 0, tasks: 0 };
  for (const p of MEMBERS) await seedGoals(tenant, ids, p, owner, counts);
  console.log(`Goals created: ${counts.goals}, tasks created: ${counts.tasks}`);
  await seedAppraisals(tenant, ids, hr);
  console.log(`\nDone. Sign in with any email above, password ${PASSWORD}.`);
}

async function upsertUsers(tenant, hr) {
  await prisma.department.upsert({
    where: { tenantId_name: { tenantId: tenant.id, name: TEAM.department } },
    update: {},
    create: { tenantId: tenant.id, name: TEAM.department, sortOrder: 20, isActive: true },
  });
  const passwordHash = await bcrypt.hash(PASSWORD, 10);
  const ids = {};
  for (const p of PEOPLE) {
    const existing = await prisma.tenantUser.findUnique({ where: { email: p.email } });
    if (existing) {
      if (existing.tenantId !== tenant.id) throw new Error(`${p.email} already exists in another tenant`);
      ids[p.local] = existing.id;
      continue;
    }
    const created = await prisma.tenantUser.create({
      data: {
        tenantId: tenant.id, email: p.email, name: p.name, passwordHash, role: p.role, status: 'ACTIVE',
        mustChangePassword: false, isVerified: true, verificationStatus: 'VERIFIED', empType: 'PERMANENT',
        employeeId: p.employeeId, department: TEAM.department, designation: p.designation, band: p.band,
        officeLocation: 'Site Office — Gomti Nagar Extension, Lucknow', gender: p.gender,
        phone: `+91 97${String(20000000 + PEOPLE.indexOf(p) * 1379).slice(0, 8)}`,
        presentCity: 'Lucknow', presentState: 'Uttar Pradesh', joinDate: utc(2024, 5, 3),
      },
    });
    ids[p.local] = created.id;
  }
  // Team managers report to the CMD, same as the other teams.
  const cmd = await prisma.tenantUser.findFirstOrThrow({ where: { tenantId: tenant.id, role: 'CMD', isDeleted: false } });
  await prisma.tenantUser.update({ where: { id: ids[MANAGER.local] }, data: { managerId: cmd.id } });
  for (const m of MEMBERS) await prisma.tenantUser.update({ where: { id: ids[m.local] }, data: { managerId: ids[MANAGER.local] } });
  console.log(`Users ready: ${PEOPLE.length}`);
  return ids;
}

// ── Goals & tasks ───────────────────────────────────────────────────────────
async function createGoal(tenant, ids, p, owner, g, counts) {
  const employeeId = ids[p.local];
  if (await prisma.goal.findFirst({ where: { tenantId: tenant.id, employeeId, title: g.title } })) return;
  const done = g.tasks.filter((t) => t.status === 'done').length;
  const goal = await prisma.goal.create({
    data: {
      tenantId: tenant.id, employeeId, createdById: owner.id, createdBy: owner.name, ownerManagerId: owner.id,
      title: g.title, description: g.description, category: TEAM.name, priority: 'high', goalType: 'General',
      status: g.status, approvalMode: 'MANAGER_APPROVAL', progress: g.progress, financialYear: g.fy, quarter: g.quarter,
      startDate: g.start, targetDate: g.end, dueDate: g.end, milestones: g.tasks.length, completedMilestones: done,
      weightLockExempt: false, createdAt: g.start,
      ...(g.rating !== undefined && { managerRating: g.rating, managerRatingNotes: g.ratingNotes, closedAt: g.closedAt, closedById: owner.id }),
    },
  });
  await prisma.goalAssignment.create({
    data: {
      tenantId: tenant.id, goalId: goal.id, employeeId, assignedById: owner.id, status: g.assignmentStatus,
      progress: g.progress, milestones: g.tasks.length, completedMilestones: done, createdAt: g.start,
      ...(g.rating !== undefined && { managerRating: g.rating }),
    },
  });
  await prisma.goalAuditLog.create({ data: { goalId: goal.id, performedById: owner.id, action: 'GOAL_CREATED', createdAt: g.start, details: `${owner.name} created goal "${g.title}" and assigned it to ${p.name} (${SEED_TAG}).` } });
  counts.goals += 1;

  for (const t of g.tasks) {
    const task = await prisma.task.create({
      data: {
        tenantId: tenant.id, employeeId, goalId: goal.id, title: t.title,
        description: t.description || `${t.title}. Part of goal "${g.title}".`,
        priority: t.priority || 'medium', status: t.status, progress: t.progress, weight: t.weight,
        startDate: t.start, dueDate: t.due, actualStartDate: t.actualStart ?? null, actualCompletionDate: t.doneAt ?? null,
        financialYear: g.fy, tags: SEED_TAG, isPrivate: false, isStandalone: false,
        reviewStatus: t.reviewStatus ?? null, reviewSubmittedAt: t.reviewSubmittedAt ?? null,
        ...(t.reviewStatus === 'APPROVED' && { reviewedById: owner.id, reviewedAt: addDays(t.doneAt, 1) }),
        ...(t.rating !== undefined && {
          managerRating: t.rating, managerRatedById: owner.id, managerRatedAt: addDays(t.doneAt, 1),
          managerRatingNotes: t.rating >= 4.5 ? 'Excellent work.' : t.rating >= 3.5 ? 'Good, on track.' : 'Needs improvement.',
        }),
        ...(t.finalWeight !== undefined && {
          managerFinalWeight: t.finalWeight, weightAdjustedById: owner.id, weightAdjustedAt: addDays(t.doneAt, 1),
          weightAdjustReason: `Delivered ${t.lateDays} days after the due date.`,
        }),
      },
    });
    counts.tasks += 1;
    if (t.comment) await prisma.taskComment.create({ data: { taskId: task.id, authorId: t.comment.by, comment: t.comment.text, attachments: [] } });
  }
}

/** A closed, rated quarter: 2 tasks a month, rated by the goal owner; late profile delivers some late. */
function closedQuarter(p, qi) {
  const months = [0, 1, 2].map((k) => { const mm = 3 + qi * 3 + k; return [2025 + (mm >= 12 ? 1 : 0), mm % 12]; });
  const weights = [15, 15, 15, 20, 15, 20];
  const tasks = [];
  months.forEach(([y, m], mi) => {
    const rating = ratingFor(p, y * 12 + m);
    for (let ti = 0; ti < 2; ti += 1) {
      const weight = weights[tasks.length];
      const due = utc(y, m, ti === 0 ? 12 : 25);
      const late = p.profile === 'late' && mi > 0 && ti === 1;
      const lateDays = late ? 4 : 0;
      const doneAt = addDays(due, late ? lateDays : -1);
      tasks.push({
        title: `${TEAM.work[(mi * 2 + ti + qi) % 6]} — ${MONTHS[m]} ${y}`,
        status: 'done', progress: 100, weight, start: addDays(due, -9), due, actualStart: addDays(due, -9), doneAt,
        reviewStatus: 'APPROVED', rating: clamp(ti === 0 ? rating : rating - (rating >= 4.5 ? 0.5 : 0)),
        ...(late && { finalWeight: weight - 5, lateDays }),
      });
    }
  });
  const goalRating = halfStep(mean(tasks.map((t) => t.rating)));
  const [ly, lm] = months[2];
  const label = `${MONTHS[months[0][1]].slice(0, 3)}–${MONTHS[lm].slice(0, 3)} ${ly}`;
  return {
    title: `${label}: ${TEAM.goals[qi]}`, description: `${TEAM.goals[qi]} for ${label}. Goal owner rates each task on completion.`,
    status: 'COMPLETED', assignmentStatus: 'COMPLETED', progress: 100, fy: 'FY 2025-26', quarter: `Q${qi + 1}`,
    start: utc(months[0][0], months[0][1], 1), end: utc(ly, lm + 1, 0), tasks,
    rating: goalRating, closedAt: utc(ly, lm + 1, 3),
    ratingNotes: goalRating >= 4.5 ? 'Outstanding delivery on this goal.' : goalRating >= 3.5 ? 'Goal achieved as planned.' : 'Goal achieved with delays; plan better.',
  };
}

/** The live Oct–Dec 2026 goal to complete during the demo. */
function demoGoal(p, owner, selfId) {
  const r = clamp(halfStep(BASE[p.profile]));
  const tasks = [
    {
      title: 'Monthly site safety inspection — October 2026', status: 'done', progress: 100, weight: 15,
      start: utc(2026, 9, 1), due: utc(2026, 9, 10), actualStart: utc(2026, 9, 1), doneAt: utc(2026, 9, 9), reviewStatus: 'APPROVED', rating: r,
    },
    {
      title: 'Concrete cube test audit — Tower B (delivered late)', status: 'done', progress: 100, weight: 15,
      start: utc(2026, 9, 5), due: utc(2026, 9, 20), actualStart: utc(2026, 9, 6), doneAt: utc(2026, 9, 26), reviewStatus: 'APPROVED',
      rating: clamp(r - 1), finalWeight: 10, lateDays: 6,
      comment: { by: owner.id, text: 'Audit report came in 6 days after the due date; final weightage reduced from 15 to 10.' },
    },
    {
      title: 'Snag list closure verification — Tower A', status: 'in_review', progress: 100, weight: 20,
      start: utc(2026, 9, 12), due: utc(2026, 10, 4), actualStart: utc(2026, 9, 12),
      reviewStatus: 'SUBMITTED', reviewSubmittedAt: utc(2026, 10, 3),
      comment: { by: selfId, text: 'All 142 snags verified and closed. Checklist uploaded — submitted for your review.' },
    },
    {
      title: 'Third-party material testing — cement & steel lots', status: 'in_progress', progress: 60, weight: 15,
      start: utc(2026, 9, 8), due: utc(2026, 9, 28), actualStart: utc(2026, 9, 9),
      comment: { by: owner.id, text: 'This is past its due date (28 Oct). Please close it and share the lab reports.' },
    },
    {
      title: 'Toolbox talk & PPE compliance drive — all sites', status: 'todo', progress: 0, weight: 15,
      start: utc(2026, 9, 20), due: utc(2026, 10, 3),
    },
    {
      title: 'Quarterly QHSE MIS report — Oct–Dec 2026', status: 'todo', progress: 0, weight: 20,
      start: utc(2026, 11, 1), due: utc(2026, 11, 20),
    },
  ];
  return {
    title: 'Oct–Dec 2026: Site safety & quality compliance — Phase 2',
    description: 'Current-quarter QHSE goal. Some tasks are done and rated, one is awaiting review, and two are past their due date.',
    status: 'ACTIVE', assignmentStatus: 'IN_PROGRESS', progress: 39, fy: 'FY 2026-27', quarter: 'Q3',
    start: utc(2026, 9, 1), end: utc(2026, 11, 31), tasks,
  };
}

async function seedGoals(tenant, ids, p, owner, counts) {
  for (const qi of [0, 1, 2]) await createGoal(tenant, ids, p, owner, closedQuarter(p, qi), counts);
  await createGoal(tenant, ids, p, owner, demoGoal(p, owner, ids[p.local]), counts);
}

// ── Appraisals (FY 2025-26 monthly + quarterly) ─────────────────────────────
async function cycleFor(tenant, period, hrId) {
  let cycle = await prisma.appraisalCycle.findFirst({ where: { tenantId: tenant.id, frequency: period.frequency, name: period.name } });
  if (!cycle) {
    cycle = await prisma.appraisalCycle.create({
      data: {
        tenantId: tenant.id, name: period.name, frequency: period.frequency, year: period.year, month: period.month,
        monthNumber: period.monthNumber, createdById: hrId, startDate: period.startDate, endDate: period.endDate, status: 'ACTIVE',
      },
    });
    await prisma.appraisalParameter.createMany({ data: PARAMETERS.map((name, i) => ({ tenantId: tenant.id, cycleId: cycle.id, name, order: i + 1, isActive: true })) });
  }
  return cycle;
}

async function seedAppraisals(tenant, ids, hr) {
  const settings = await prisma.tenantSettings.findFirst({ where: { tenantId: tenant.id } });
  const periods = [
    getPeriodMetadata('MONTHLY', new Date(), null, 2025, 4, settings),
    getPeriodMetadata('MONTHLY', new Date(), null, 2025, 5, settings),
    getPeriodMetadata('QUARTERLY', new Date(), null, 2025, 'Q1', settings),
    getPeriodMetadata('MONTHLY', new Date(), null, 2025, 7, settings),
    getPeriodMetadata('MONTHLY', new Date(), null, 2025, 8, settings),
    getPeriodMetadata('QUARTERLY', new Date(), null, 2025, 'Q2', settings),
    getPeriodMetadata('MONTHLY', new Date(), null, 2025, 10, settings),
    getPeriodMetadata('MONTHLY', new Date(), null, 2025, 11, settings),
    getPeriodMetadata('QUARTERLY', new Date(), null, 2025, 'Q3', settings),
  ];
  let written = 0;
  for (const period of periods) {
    const cycle = await cycleFor(tenant, period, hr.id);
    const eligible = MEMBERS.filter((p) => !Q3_PERIODS.includes(period.name) || p.submitsQ3);
    const metrics = await getTeamTableMetricsBulk(tenant.id, eligible.map((p) => ids[p.local]), cycle);
    for (const p of eligible) {
      const employeeId = ids[p.local];
      if (await prisma.performanceReview.findFirst({ where: { cycleId: cycle.id, employeeId } })) continue;
      const m = metrics.get(employeeId);
      const base = m?.managerRating ?? BASE[p.profile];
      const selfRating = clamp(halfStep(base + (p.profile === 'late' ? 0.5 : 0)));
      const tone = base >= 4.3 ? 'high' : base >= 3.3 ? 'mid' : 'low';
      const submittedAt = addDays(new Date(period.endDate), 3);
      const locked = LOCKED.includes(period.name);
      const lockedAt = addDays(submittedAt, 6);
      await prisma.performanceReview.create({
        data: {
          cycleId: cycle.id, employeeId, reviewType: period.frequency, dueDate: period.endDate,
          status: locked ? 'COMPLETED' : 'SUBMITTED', selfRating, selfAccomplishments: `${period.name}: ${ACHIEVEMENTS[tone]}`, selfSubmittedAt: submittedAt,
          managerTaskRatingSnapshot: m ? { ...m, snapshotAt: submittedAt.toISOString() } : undefined,
          workScore: m?.finalWeight ?? null, averageManagerRating: m?.managerRating ?? null,
          ...(locked && {
            hrRemarks: tone === 'high' ? 'Outstanding period. Keep it up.' : tone === 'mid' ? 'Solid, consistent performance.' : 'Focus on on-time delivery next period.',
            hrSignoffStatus: 'FINALISED', hrSignedOffById: hr.id, hrSignedOffAt: lockedAt, finalisedAt: lockedAt, finalisedById: hr.id,
          }),
        },
      });
      written += 1;
    }
  }
  console.log(`FY 2025-26 monthly/quarterly appraisals written: ${written}`);
}

// ── Cleanup: only this team's users and their data ──────────────────────────
async function cleanup(tenant) {
  const users = await prisma.tenantUser.findMany({ where: { tenantId: tenant.id, email: { in: PEOPLE.map((p) => p.email) } }, select: { id: true, email: true } });
  const ids = users.map((u) => u.id);
  console.log(`Would remove ${users.length} users (${users.map((u) => u.email).join(', ')}) and their goals, tasks and appraisals.`);
  if (!APPLY || !ids.length) return console.log(ids.length ? 'Dry run — re-run with --cleanup --apply to delete.' : 'Nothing to remove.');
  const goalIds = (await prisma.goal.findMany({ where: { tenantId: tenant.id, employeeId: { in: ids } }, select: { id: true } })).map((g) => g.id);
  const taskIds = (await prisma.task.findMany({ where: { tenantId: tenant.id, employeeId: { in: ids } }, select: { id: true } })).map((t) => t.id);
  await prisma.taskComment.deleteMany({ where: { taskId: { in: taskIds } } });
  await prisma.taskAuditLog.deleteMany({ where: { taskId: { in: taskIds } } });
  await prisma.taskMilestone.deleteMany({ where: { taskId: { in: taskIds } } });
  await prisma.task.deleteMany({ where: { id: { in: taskIds } } });
  await prisma.goalComment.deleteMany({ where: { goalId: { in: goalIds } } });
  await prisma.goalAuditLog.deleteMany({ where: { goalId: { in: goalIds } } });
  await prisma.goalAssignment.deleteMany({ where: { goalId: { in: goalIds } } });
  await prisma.goal.deleteMany({ where: { id: { in: goalIds } } });
  await prisma.reviewScore.deleteMany({ where: { review: { employeeId: { in: ids } } } });
  await prisma.performanceReview.deleteMany({ where: { employeeId: { in: ids } } });
  await prisma.notification.deleteMany({ where: { recipientId: { in: ids } } }).catch(() => {});
  await prisma.tenantUser.updateMany({ where: { id: { in: ids } }, data: { managerId: null } });
  await prisma.tenantUser.deleteMany({ where: { id: { in: ids } } });
  console.log('Removed.');
}

main()
  .catch((err) => { console.error(err); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
