/**
 * @file seedAnnualTestFY2025.js
 * @description Fills FY 2025-26 (Apr 2025 – Mar 2026) for the appraisal test
 * team created by seedAppraisalTestTeam.js, so the ANNUAL appraisal for
 * 2025-26 can be tested end to end.
 *
 * For each of the 6 people (Ritesh + 5 members):
 *   - One goal per quarter (Q1 Apr–Jun, Q2 Jul–Sep, Q3 Oct–Dec 2025), closed
 *     with a goal rating. The goal owner differs from the reporting manager on
 *     purpose: Q1 → Ritesh (the manager), Q2 → Anil Kumar Sahoo,
 *     Q3 → Manas Ranjan Behera. The existing Jan–Mar 2026 (Q4) goals get their
 *     goal rating too. Ritesh's own goals: Q1/Q4 → CMD, Q2 → Anil, Q3 → Manas.
 *   - Two tasks a month, done and rated by that goal's owner; Subham's late
 *     tasks have Final Weightage cuts; Tanmay has no August 2025 tasks.
 *   - Monthly (Apr, May, Jul, Aug, Oct, Nov, Jan, Feb) and quarterly (Q1–Q4)
 *     appraisals submitted with a half-step self rating, comments and the
 *     Team-table snapshot. HR has locked everything up to December 2025;
 *     Jan, Feb and Q4 are left awaiting HR.
 *   - Join date moved to June 2024.
 * The FY 2025-26 ANNUAL appraisal is not created — that is what gets tested.
 *
 * Dry run by default. Safe to re-run: existing goals/tasks are skipped and
 * appraisals already submitted or locked are never overwritten.
 *
 *   node seeddata/seedAnnualTestFY2025.js           # show the plan
 *   node seeddata/seedAnnualTestFY2025.js --apply   # write it
 *
 * Remove everything with: node seeddata/seedAppraisalTestTeam.js --cleanup --apply
 */
import 'dotenv/config';
import { prisma } from '../src/lib/prisma.js';
import { getPeriodMetadata, isQuarterEndMonth } from '../src/lib/appraisalPeriods.js';
import { getTeamTableMetrics } from '../src/services/appraisalMetrics.service.js';

const DOMAIN = 'cityexpertcare.com';
const APPLY = process.argv.includes('--apply');
const FY = 'FY 2025-26';
const FY_START_YEAR = 2025;
const SEED_TAG = 'seed:appraisal-test';
const LOCK_BEFORE = new Date(Date.UTC(2026, 0, 1)); // periods ending before this are locked by HR

const DEFAULT_PARAMETERS = ['Technical Skills', 'Conduct & Ethics', 'Punctuality & Attendance', 'Communication', 'Teamwork & Collaboration'];

// Ratings Apr..Dec 2025 (index 0..8); null = no tasks that month.
const PEOPLE = [
  { email: 'ritesh.panda', ratings: [4, 4, 4.5, 4, 4.5, 4, 4.5, 4, 4.5], managerSelf: true },
  { email: 'ipsita.rath', ratings: [4.5, 5, 4.5, 5, 4.5, 5, 5, 4.5, 5] },
  { email: 'bikash.swain', ratings: [3.5, 3.5, 4, 3.5, 4, 3.5, 4, 4, 3.5] },
  { email: 'lipika.nanda', ratings: [2.5, 3.5, 4, 4.5, 3, 4, 3.5, 5, 4] },
  { email: 'subham.behera', ratings: [3, 2.5, 3, 2.5, 3, 3, 2.5, 3, 3], late: true },
  { email: 'tanmay.mishra', ratings: [4, 3.5, 4, 3.5, null, 4, 3.5, 4, 4] },
];
const QUARTERS = [
  { quarter: 'Q1', label: 'Apr–Jun 2025', months: [3, 4, 5], owner: 'manager', title: 'Customer onboarding excellence' },
  { quarter: 'Q2', label: 'Jul–Sep 2025', months: [6, 7, 8], owner: 'anil', title: 'Support process automation (cross-team)' },
  { quarter: 'Q3', label: 'Oct–Dec 2025', months: [9, 10, 11], owner: 'manas', title: 'Product feedback programme (cross-team)' },
];
const WEIGHTS = [[15, 15], [15, 20], [15, 20]];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const WORK = [
  ['Onboard new enterprise accounts', 'Document onboarding playbook'],
  ['Automate ticket triage rules', 'Measure first-response time'],
  ['Collect customer feature requests', 'Run quarterly product review with customers'],
];
const ACHIEVEMENTS = {
  high: 'Exceeded the CSAT target and resolved every escalated ticket within SLA. Mentored a new joiner.',
  mid: 'Met the CSAT and SLA targets for the period and completed all planned tasks.',
  low: 'Completed the assigned work; two deliveries slipped and I am improving my planning.',
};

const utc = (y, m, d) => new Date(Date.UTC(y, m, d));
const addDays = (date, n) => new Date(date.getTime() + n * 86400000);
const clamp = (r) => Math.min(5, Math.max(1, r));
const halfStep = (r) => Math.round(r * 2) / 2;

async function main() {
  const tenant = await prisma.tenant.findFirst({ where: { domainName: DOMAIN }, select: { id: true, companyName: true } });
  if (!tenant) throw new Error(`Tenant ${DOMAIN} not found`);
  const settings = await prisma.tenantSettings.findFirst({ where: { tenantId: tenant.id } });
  const find = (where) => prisma.tenantUser.findFirst({ where: { tenantId: tenant.id, isDeleted: false, ...where }, select: { id: true, name: true } });

  const cmd = await find({ role: 'CMD' });
  const hr = await find({ role: 'HR' });
  const anil = await find({ name: 'Anil Kumar Sahoo' });
  const manas = await find({ name: 'Manas Ranjan Behera' });
  const ritesh = await find({ email: `ritesh.panda@${DOMAIN}` });
  if (!cmd || !hr || !anil || !manas || !ritesh) throw new Error('Missing CMD / HR / Anil / Manas / Ritesh — run seedAppraisalTestTeam.js first');

  const people = [];
  for (const p of PEOPLE) {
    const user = await find({ email: `${p.email}@${DOMAIN}` });
    if (!user) throw new Error(`${p.email}@${DOMAIN} not found — run seedAppraisalTestTeam.js first`);
    people.push({ ...p, user });
  }

  // Periods: monthly (quarter-end months have none) + quarterly.
  const monthly = [];
  for (let i = 0; i < 12; i += 1) {
    const monthIndex = (3 + i) % 12;
    const year = FY_START_YEAR + (3 + i >= 12 ? 1 : 0);
    if (isQuarterEndMonth(monthIndex + 1, settings)) continue;
    monthly.push(getPeriodMetadata('MONTHLY', new Date(), null, year, monthIndex + 1, settings));
  }
  const quarterly = ['Q1', 'Q2', 'Q3', 'Q4'].map((q) => getPeriodMetadata('QUARTERLY', new Date(), null, FY_START_YEAR, q, settings));
  const periods = [...monthly, ...quarterly];

  console.log(`Tenant: ${tenant.companyName}  mode: ${APPLY ? 'APPLY' : 'DRY RUN'}`);
  console.log(`People: ${people.map((p) => p.user.name).join(', ')}`);
  console.log(`Goal owners: Q1 ${ritesh.name} (members) / ${cmd.name} (Ritesh), Q2 ${anil.name}, Q3 ${manas.name}, Q4 existing`);
  console.log(`Appraisals: ${periods.map((p) => p.name).join(', ')}`);
  console.log(`Locked by ${hr.name}: periods ending before 1 Jan 2026; the rest awaiting HR.`);
  if (!APPLY) {
    console.log('\nDry run — nothing written. Re-run with --apply.');
    return;
  }

  const ownerFor = (q, person) => {
    if (q.owner === 'anil') return anil;
    if (q.owner === 'manas') return manas;
    return person.managerSelf ? cmd : ritesh;
  };

  let goals = 0;
  let tasks = 0;
  for (const person of people) {
    await prisma.tenantUser.update({ where: { id: person.user.id }, data: { joinDate: utc(2024, 5, 3) } });

    for (const [qi, q] of QUARTERS.entries()) {
      const owner = ownerFor(q, person);
      const title = `${q.label}: ${q.title}`;
      let goal = await prisma.goal.findFirst({ where: { tenantId: tenant.id, employeeId: person.user.id, title } });
      const monthRatings = q.months.map((m) => person.ratings[m - 3]);
      if (!goal) {
        goal = await prisma.goal.create({
          data: {
            tenantId: tenant.id, employeeId: person.user.id, createdById: owner.id, createdBy: owner.name,
            ownerManagerId: owner.id, title,
            description: `${q.title} for ${q.label}. Goal owner: ${owner.name}. Seeded for annual appraisal testing.`,
            category: 'Customer Success', priority: 'high', goalType: 'General', status: 'COMPLETED',
            approvalMode: 'MANAGER_APPROVAL', progress: 100, financialYear: FY, quarter: q.quarter,
            startDate: utc(2025, q.months[0], 1), targetDate: utc(2025, q.months[2] + 1, 0), dueDate: utc(2025, q.months[2] + 1, 0),
            milestones: 6, completedMilestones: 6, weightLockExempt: false,
          },
        });
        await prisma.goalAssignment.create({
          data: { tenantId: tenant.id, goalId: goal.id, employeeId: person.user.id, assignedById: owner.id, status: 'COMPLETED', progress: 100 },
        }).catch(() => {});
        goals += 1;
      }

      for (const [mi, month] of q.months.entries()) {
        const rating = person.ratings[month - 3];
        if (rating === null) continue;
        for (const [ti, weight] of WEIGHTS[mi].entries()) {
          const taskTitle = `${WORK[qi][ti]} — ${MONTHS[month]} 2025`;
          if (await prisma.task.findFirst({ where: { tenantId: tenant.id, employeeId: person.user.id, title: taskTitle } })) continue;
          const due = utc(2025, month, ti === 0 ? 12 : 25);
          const isLate = person.late && ti === 1 && mi !== 0;
          const done = isLate ? addDays(due, 4) : due;
          const taskRating = clamp(ti === 0 ? rating : rating - (rating >= 4.5 ? 0.5 : 0));
          await prisma.task.create({
            data: {
              tenantId: tenant.id, employeeId: person.user.id, goalId: goal.id, title: taskTitle,
              description: `Seeded task for annual appraisal testing (${MONTHS[month]} 2025).`,
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

      const rated = monthRatings.filter((r) => r !== null);
      const goalRating = halfStep(rated.reduce((a, b) => a + b, 0) / rated.length);
      await rateGoal(goal, person.user.id, owner, goalRating, utc(2025, q.months[2] + 1, 3));
    }

    // Existing Jan–Mar 2026 goal (from seedAppraisalTestTeam.js): add its goal rating.
    const q4 = await prisma.goal.findFirst({
      where: { tenantId: tenant.id, employeeId: person.user.id, title: { startsWith: 'Jan–Mar 2026' } },
      include: { tasks: { select: { managerRating: true } } },
    });
    if (q4) {
      const ratings = q4.tasks.map((t) => t.managerRating).filter((r) => r !== null);
      const owner = (await prisma.tenantUser.findUnique({ where: { id: q4.ownerManagerId }, select: { id: true, name: true } })) || ritesh;
      if (ratings.length) await rateGoal(q4, person.user.id, owner, halfStep(ratings.reduce((a, b) => a + b, 0) / ratings.length), utc(2026, 3, 3));
    }
  }
  console.log(`Goals created: ${goals}, tasks created: ${tasks}`);

  // Monthly + quarterly appraisals.
  const tenantParams = await prisma.appraisalParameter.findMany({ where: { tenantId: tenant.id }, distinct: ['name'], orderBy: { order: 'asc' } });
  const paramSeed = tenantParams.length
    ? tenantParams.map((p) => ({ name: p.name, order: p.order, isActive: p.isActive }))
    : DEFAULT_PARAMETERS.map((name, i) => ({ name, order: i + 1, isActive: true }));

  let created = 0;
  let skipped = 0;
  for (const period of periods) {
    let cycle = await prisma.appraisalCycle.findFirst({ where: { tenantId: tenant.id, frequency: period.frequency, name: period.name } });
    if (!cycle) {
      cycle = await prisma.appraisalCycle.create({
        data: {
          tenantId: tenant.id, name: period.name, frequency: period.frequency, year: period.year, month: period.month,
          monthNumber: period.monthNumber, createdById: hr.id, startDate: period.startDate, endDate: period.endDate, status: 'ACTIVE',
        },
      });
      await prisma.appraisalParameter.createMany({ data: paramSeed.map((p) => ({ tenantId: tenant.id, cycleId: cycle.id, ...p })) });
    }

    for (const person of people) {
      const existing = await prisma.performanceReview.findFirst({ where: { cycleId: cycle.id, employeeId: person.user.id } });
      if (existing && existing.status !== 'DRAFT') { skipped += 1; continue; }

      const metrics = await getTeamTableMetrics(tenant.id, person.user.id, cycle);
      const base = metrics?.managerRating ?? 3.5;
      const selfRating = clamp(halfStep(base + (person.email === 'subham.behera' ? 0.5 : person.email === 'lipika.nanda' ? -0.5 : 0)));
      const tone = base >= 4.3 ? 'high' : base >= 3.3 ? 'mid' : 'low';
      const submittedAt = addDays(new Date(period.endDate), 3);
      const lock = new Date(period.endDate) < LOCK_BEFORE;
      const lockedAt = addDays(submittedAt, 7);
      const data = {
        reviewType: period.frequency, dueDate: period.endDate,
        status: lock ? 'COMPLETED' : 'SUBMITTED',
        selfRating, selfAccomplishments: `${period.name}: ${ACHIEVEMENTS[tone]}`, selfSubmittedAt: submittedAt,
        managerTaskRatingSnapshot: metrics ? { ...metrics, snapshotAt: submittedAt.toISOString() } : undefined,
        workScore: metrics?.finalWeight ?? null, averageManagerRating: metrics?.managerRating ?? null,
        ...(lock && {
          hrRemarks: tone === 'high' ? 'Outstanding period. Keep it up.' : tone === 'mid' ? 'Solid, consistent performance.' : 'Focus on on-time delivery next period.',
          hrSignoffStatus: 'FINALISED', hrSignedOffById: hr.id, hrSignedOffAt: lockedAt, finalisedAt: lockedAt, finalisedById: hr.id,
        }),
      };
      if (existing) await prisma.performanceReview.update({ where: { id: existing.id }, data });
      else await prisma.performanceReview.create({ data: { cycleId: cycle.id, employeeId: person.user.id, ...data } });
      created += 1;
    }
  }
  console.log(`Appraisals written: ${created}, left untouched (already submitted/locked): ${skipped}`);
}

/** Close a goal the way the goal owner's approval does: goal + assignment rating, notes, closed by/at. */
async function rateGoal(goal, employeeId, owner, rating, at) {
  const notes = rating >= 4.5 ? 'Outstanding delivery on this goal.' : rating >= 3.5 ? 'Goal achieved as planned.' : 'Goal achieved with delays; plan better.';
  await prisma.goal.update({
    where: { id: goal.id },
    data: { managerRating: rating, managerRatingNotes: notes, closedAt: at, closedById: owner.id, status: 'COMPLETED', progress: 100 },
  });
  await prisma.goalAssignment.updateMany({ where: { goalId: goal.id, employeeId }, data: { managerRating: rating, status: 'COMPLETED', progress: 100 } });
}

main()
  .catch((err) => { console.error(err.message); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
