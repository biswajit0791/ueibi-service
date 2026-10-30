/**
 * @file seedAnnualTestTeam2.js
 * @description A second test team in cityexpertcare.com for the FY 2025-26
 * ANNUAL appraisal, where the employee submits the annual self-assessment by
 * hand and the manager / HR steps follow.
 *
 *   Manager  Sanjay Mallick (MANAGER) → reports to the CMD
 *   Members  Priyanka Jena, Rohit Sahu, Ananya Patnaik
 *
 * FY 2025-26 (Apr 2025 – Mar 2026) for each of the 4:
 *   - one goal per quarter, closed with a goal rating; goal owners differ
 *     from the reporting manager: Q1 → Sanjay (CMD for Sanjay), Q2 → Anil
 *     Kumar Sahoo, Q3 → Manas Ranjan Behera, Q4 → Sanjay (CMD for Sanjay)
 *   - two tasks a month, done and rated by the goal owner
 *   - monthly (Apr, May, Jul, Aug, Oct, Nov, Jan, Feb) and quarterly (Q1–Q4)
 *     self-appraisals SUBMITTED with the Team-table snapshot
 * The annual appraisal is NOT created.
 *
 *   node seeddata/seedAnnualTestTeam2.js            # show the plan
 *   node seeddata/seedAnnualTestTeam2.js --apply    # create it
 *   node seeddata/seedAnnualTestTeam2.js --cleanup  # show what would be removed (add --apply to remove)
 *
 * Password for all four: TEST_PASSWORD below.
 */
import 'dotenv/config';
import bcrypt from 'bcryptjs';
import { prisma } from '../src/lib/prisma.js';
import { getPeriodMetadata, isQuarterEndMonth } from '../src/lib/appraisalPeriods.js';
import { getTeamTableMetrics } from '../src/services/appraisalMetrics.service.js';

const DOMAIN = 'cityexpertcare.com';
const DEPARTMENT = 'Field Services';
const TEST_PASSWORD = 'Test@1234';
const SEED_TAG = 'seed:appraisal-test-2';
const APPLY = process.argv.includes('--apply');
const CLEANUP = process.argv.includes('--cleanup');
const FY = 'FY 2025-26';
const FY_START_YEAR = 2025;

const MANAGER = { name: 'Sanjay Mallick', email: `sanjay.mallick@${DOMAIN}`, designation: 'Field Services Manager', employeeId: 'CEC-FS-200' };
// Ratings for the 12 months Apr 2025 .. Mar 2026.
const MEMBERS = [
  { name: 'Priyanka Jena', email: `priyanka.jena@${DOMAIN}`, designation: 'Senior Field Engineer', employeeId: 'CEC-FS-201', ratings: [4.5, 4.5, 5, 4.5, 5, 4.5, 5, 4.5, 5, 4.5, 5, 4.5] },
  { name: 'Rohit Sahu', email: `rohit.sahu@${DOMAIN}`, designation: 'Field Engineer', employeeId: 'CEC-FS-202', ratings: [3.5, 3, 3.5, 4, 3.5, 3.5, 4, 3.5, 3, 3.5, 4, 3.5], late: true },
  { name: 'Ananya Patnaik', email: `ananya.patnaik@${DOMAIN}`, designation: 'Field Engineer', employeeId: 'CEC-FS-203', ratings: [3, 3.5, 4, 4, 4.5, 4, 4, 4.5, 4.5, 4.5, 5, 4.5] },
];
const MANAGER_RATINGS = [4, 4, 4.5, 4, 4, 4.5, 4.5, 4, 4.5, 4, 4.5, 4];

// month = 0-based calendar month; year computed from it (Apr–Dec 2025, Jan–Mar 2026).
const QUARTERS = [
  { quarter: 'Q1', label: 'Apr–Jun 2025', months: [3, 4, 5], owner: 'manager', title: 'Field service turnaround time' },
  { quarter: 'Q2', label: 'Jul–Sep 2025', months: [6, 7, 8], owner: 'anil', title: 'Remote diagnostics rollout (cross-team)' },
  { quarter: 'Q3', label: 'Oct–Dec 2025', months: [9, 10, 11], owner: 'manas', title: 'Installation quality programme (cross-team)' },
  { quarter: 'Q4', label: 'Jan–Mar 2026', months: [0, 1, 2], owner: 'manager', title: 'Preventive maintenance coverage' },
];
const WEIGHTS = [[15, 15], [15, 20], [15, 20]];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const WORK = [
  ['Close field service tickets within SLA', 'Update job-sheet records'],
  ['Pilot remote diagnostics with customers', 'Report diagnostics success rate'],
  ['Audit installation quality', 'Train installers on the new checklist'],
  ['Complete scheduled maintenance visits', 'Log spare-parts usage'],
];
const ACHIEVEMENTS = {
  high: 'Exceeded the SLA and first-time-fix targets; handled the most complex site visits.',
  mid: 'Met SLA and first-time-fix targets and completed all planned visits.',
  low: 'Completed the assigned visits; a few reports were late and I am improving my planning.',
};

const yearOf = (month) => (month >= 3 ? 2025 : 2026);
const utc = (y, m, d) => new Date(Date.UTC(y, m, d));
const addDays = (date, n) => new Date(date.getTime() + n * 86400000);
const clamp = (r) => Math.min(5, Math.max(1, r));
const halfStep = (r) => Math.round(r * 2) / 2;
const ratingIndex = (month) => (month - 3 + 12) % 12; // Apr → 0 … Mar → 11

async function main() {
  const tenant = await prisma.tenant.findFirst({ where: { domainName: DOMAIN }, select: { id: true, companyName: true, licenseLimit: true } });
  if (!tenant) throw new Error(`Tenant ${DOMAIN} not found`);
  const emails = [MANAGER.email, ...MEMBERS.map((m) => m.email)];
  console.log(`Tenant: ${tenant.companyName}  mode: ${CLEANUP ? 'CLEANUP' : APPLY ? 'APPLY' : 'DRY RUN'}`);
  if (CLEANUP) return cleanup(tenant, emails);

  const settings = await prisma.tenantSettings.findFirst({ where: { tenantId: tenant.id } });
  const find = (where) => prisma.tenantUser.findFirst({ where: { tenantId: tenant.id, isDeleted: false, ...where }, select: { id: true, name: true } });
  const cmd = await find({ role: 'CMD' });
  const anil = await find({ name: 'Anil Kumar Sahoo' });
  const manas = await find({ name: 'Manas Ranjan Behera' });
  if (!cmd || !anil || !manas) throw new Error('Missing CMD / Anil Kumar Sahoo / Manas Ranjan Behera');

  const active = await prisma.tenantUser.count({ where: { tenantId: tenant.id, isDeleted: false, status: { in: ['ACTIVE', 'INVITED'] } } });
  const missing = [];
  for (const e of emails) if (!(await prisma.tenantUser.findUnique({ where: { email: e } }))) missing.push(e);
  if (active + missing.length > (tenant.licenseLimit ?? 0)) throw new Error(`Not enough licenses: ${active}/${tenant.licenseLimit}, need ${missing.length}`);

  console.log(`Department: ${DEPARTMENT}`);
  console.log(`Manager: ${MANAGER.name} → reports to ${cmd.name}`);
  MEMBERS.forEach((m) => console.log(`Member:  ${m.name} <${m.email}>`));
  console.log(`Goal owners: Q1/Q4 ${MANAGER.name} (CMD for ${MANAGER.name}), Q2 ${anil.name}, Q3 ${manas.name}`);
  console.log(`Users to create: ${missing.length} (licenses ${active}/${tenant.licenseLimit}). Monthly + quarterly FY 2025-26 submitted; annual not created.`);
  if (!APPLY) {
    console.log('\nDry run — nothing written. Re-run with --apply.');
    return;
  }

  const passwordHash = await bcrypt.hash(TEST_PASSWORD, 10);
  if (!(await prisma.department.findFirst({ where: { tenantId: tenant.id, name: DEPARTMENT } }))) {
    await prisma.department.create({ data: { tenantId: tenant.id, name: DEPARTMENT } });
  }
  const upsertUser = async (p, role, managerId) => {
    const existing = await prisma.tenantUser.findUnique({ where: { email: p.email } });
    if (existing) {
      if (existing.tenantId !== tenant.id) throw new Error(`${p.email} exists in another tenant`);
      return existing;
    }
    return prisma.tenantUser.create({
      data: {
        tenantId: tenant.id, email: p.email, name: p.name, passwordHash, role, status: 'ACTIVE', mustChangePassword: false,
        department: DEPARTMENT, designation: p.designation, employeeId: p.employeeId, managerId, joinDate: utc(2024, 5, 3),
      },
    });
  };
  const manager = await upsertUser(MANAGER, 'MANAGER', cmd.id);
  const people = [{ user: manager, ratings: MANAGER_RATINGS, isManager: true }];
  for (const m of MEMBERS) people.push({ user: await upsertUser(m, 'EMPLOYEE', manager.id), ratings: m.ratings, late: m.late });

  const ownerFor = (q, person) => {
    if (q.owner === 'anil') return anil;
    if (q.owner === 'manas') return manas;
    return person.isManager ? cmd : manager;
  };

  let goals = 0;
  let tasks = 0;
  for (const person of people) {
    for (const [qi, q] of QUARTERS.entries()) {
      const owner = ownerFor(q, person);
      const first = q.months[0];
      const last = q.months[2];
      const title = `${q.label}: ${q.title}`;
      let goal = await prisma.goal.findFirst({ where: { tenantId: tenant.id, employeeId: person.user.id, title } });
      if (!goal) {
        goal = await prisma.goal.create({
          data: {
            tenantId: tenant.id, employeeId: person.user.id, createdById: owner.id, createdBy: owner.name, ownerManagerId: owner.id, title,
            description: `${q.title} for ${q.label}. Goal owner: ${owner.name}. Seeded for annual appraisal testing.`,
            category: 'Field Services', priority: 'high', goalType: 'General', status: 'COMPLETED', approvalMode: 'MANAGER_APPROVAL',
            progress: 100, financialYear: FY, quarter: q.quarter,
            startDate: utc(yearOf(first), first, 1), targetDate: utc(yearOf(last), last + 1, 0), dueDate: utc(yearOf(last), last + 1, 0),
            milestones: 6, completedMilestones: 6, weightLockExempt: false,
          },
        });
        await prisma.goalAssignment.create({
          data: { tenantId: tenant.id, goalId: goal.id, employeeId: person.user.id, assignedById: owner.id, status: 'COMPLETED', progress: 100 },
        }).catch(() => {});
        goals += 1;
      }
      const used = [];
      for (const [mi, month] of q.months.entries()) {
        const rating = person.ratings[ratingIndex(month)];
        used.push(rating);
        for (const [ti, weight] of WEIGHTS[mi].entries()) {
          const taskTitle = `${WORK[qi][ti]} — ${MONTHS[month]} ${yearOf(month)}`;
          if (await prisma.task.findFirst({ where: { tenantId: tenant.id, employeeId: person.user.id, title: taskTitle } })) continue;
          const due = utc(yearOf(month), month, ti === 0 ? 12 : 25);
          const isLate = person.late && ti === 1 && mi !== 0;
          const done = isLate ? addDays(due, 4) : due;
          const taskRating = clamp(ti === 0 ? rating : rating - (rating >= 4.5 ? 0.5 : 0));
          await prisma.task.create({
            data: {
              tenantId: tenant.id, employeeId: person.user.id, goalId: goal.id, title: taskTitle,
              description: `Seeded task for annual appraisal testing (${MONTHS[month]} ${yearOf(month)}).`,
              priority: 'medium', status: 'done', progress: 100, weight,
              startDate: addDays(due, -8), dueDate: due, actualStartDate: addDays(due, -8), actualCompletionDate: done,
              financialYear: FY, tags: SEED_TAG, isPrivate: false, isStandalone: false,
              managerRating: taskRating,
              managerRatingNotes: taskRating >= 4.5 ? 'Excellent work.' : taskRating >= 3.5 ? 'Good, on track.' : 'Needs improvement.',
              managerRatedById: owner.id, managerRatedAt: addDays(done, 1),
              ...(isLate && {
                managerFinalWeight: weight - 5, weightAdjustedById: owner.id, weightAdjustedAt: addDays(done, 1),
                weightAdjustReason: 'Delivered 4 days after the due date.',
              }),
            },
          });
          tasks += 1;
        }
      }
      const goalRating = halfStep(used.reduce((a, b) => a + b, 0) / used.length);
      const notes = goalRating >= 4.5 ? 'Outstanding delivery on this goal.' : goalRating >= 3.5 ? 'Goal achieved as planned.' : 'Goal achieved with delays; plan better.';
      await prisma.goal.update({
        where: { id: goal.id },
        data: { managerRating: goalRating, managerRatingNotes: notes, closedAt: utc(yearOf(last), last + 1, 3), closedById: owner.id },
      });
      await prisma.goalAssignment.updateMany({ where: { goalId: goal.id, employeeId: person.user.id }, data: { managerRating: goalRating } });
    }
  }
  console.log(`Goals created: ${goals}, tasks created: ${tasks}`);

  // Monthly (quarter-end months have none) + quarterly self-appraisals, submitted.
  const periods = [];
  for (let i = 0; i < 12; i += 1) {
    const month = (3 + i) % 12;
    if (isQuarterEndMonth(month + 1, settings)) continue;
    periods.push(getPeriodMetadata('MONTHLY', new Date(), null, yearOf(month), month + 1, settings));
  }
  for (const q of ['Q1', 'Q2', 'Q3', 'Q4']) periods.push(getPeriodMetadata('QUARTERLY', new Date(), null, FY_START_YEAR, q, settings));

  const tenantParams = await prisma.appraisalParameter.findMany({ where: { tenantId: tenant.id }, distinct: ['name'], orderBy: { order: 'asc' } });
  let written = 0;
  for (const period of periods) {
    let cycle = await prisma.appraisalCycle.findFirst({ where: { tenantId: tenant.id, frequency: period.frequency, name: period.name } });
    if (!cycle) {
      cycle = await prisma.appraisalCycle.create({
        data: {
          tenantId: tenant.id, name: period.name, frequency: period.frequency, year: period.year, month: period.month,
          monthNumber: period.monthNumber, startDate: period.startDate, endDate: period.endDate, status: 'ACTIVE',
        },
      });
      if (tenantParams.length) {
        await prisma.appraisalParameter.createMany({
          data: tenantParams.map((p) => ({ tenantId: tenant.id, cycleId: cycle.id, name: p.name, order: p.order, isActive: p.isActive })),
        });
      }
    }
    for (const person of people) {
      const existing = await prisma.performanceReview.findFirst({ where: { cycleId: cycle.id, employeeId: person.user.id } });
      if (existing && existing.status !== 'DRAFT') continue;
      const metrics = await getTeamTableMetrics(tenant.id, person.user.id, cycle);
      const base = metrics?.managerRating ?? 3.5;
      const selfRating = clamp(halfStep(base));
      const tone = base >= 4.3 ? 'high' : base >= 3.3 ? 'mid' : 'low';
      const submittedAt = addDays(new Date(period.endDate), 3);
      const data = {
        reviewType: period.frequency, dueDate: period.endDate, status: 'SUBMITTED',
        selfRating, selfAccomplishments: `${period.name}: ${ACHIEVEMENTS[tone]}`, selfSubmittedAt: submittedAt,
        managerTaskRatingSnapshot: metrics ? { ...metrics, snapshotAt: submittedAt.toISOString() } : undefined,
        workScore: metrics?.finalWeight ?? null, averageManagerRating: metrics?.managerRating ?? null,
      };
      if (existing) await prisma.performanceReview.update({ where: { id: existing.id }, data });
      else await prisma.performanceReview.create({ data: { cycleId: cycle.id, employeeId: person.user.id, ...data } });
      written += 1;
    }
  }
  console.log(`Monthly/quarterly appraisals submitted: ${written}`);
  console.log(`Sign in as: ${emails.join(', ')}  (password: ${TEST_PASSWORD})`);
}

async function cleanup(tenant, emails) {
  const users = await prisma.tenantUser.findMany({ where: { tenantId: tenant.id, email: { in: emails } }, select: { id: true } });
  const ids = users.map((u) => u.id);
  console.log(`Would remove ${users.length} users with their goals, tasks and appraisals.`);
  if (!APPLY) return console.log('Dry run — re-run with --cleanup --apply.');
  await prisma.performanceReview.deleteMany({ where: { employeeId: { in: ids } } });
  await prisma.task.deleteMany({ where: { tenantId: tenant.id, employeeId: { in: ids } } });
  await prisma.goalAssignment.deleteMany({ where: { tenantId: tenant.id, employeeId: { in: ids } } });
  await prisma.goal.deleteMany({ where: { tenantId: tenant.id, employeeId: { in: ids } } });
  await prisma.notification.deleteMany({ where: { recipientId: { in: ids } } }).catch(() => {});
  await prisma.tenantUser.updateMany({ where: { id: { in: ids } }, data: { isDeleted: true, status: 'EXITED' } });
  console.log('Removed.');
}

main()
  .catch((err) => { console.error(err.message); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
