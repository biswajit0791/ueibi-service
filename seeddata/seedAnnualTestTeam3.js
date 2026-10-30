/**
 * @file seedAnnualTestTeam3.js
 * @description A third test team in cityexpertcare.com for testing the FY 2025-26
 * ANNUAL appraisal entirely by hand (self-appraisal, manager review, HR, concerns).
 *
 *   Manager  Debasish Nayak (MANAGER) → reports to the CMD
 *   Members  Sneha Mohapatra, Arjun Das, Pooja Behera
 *
 * FY 2025-26 (Apr 2025 – Mar 2026) for each of the 3 members:
 *   - one goal per quarter, owned by Debasish, COMPLETED and rated
 *   - two tasks a month, done and rated by Debasish (Arjun delivers some late)
 * No appraisals of any kind are created — every appraisal step is left to the tester.
 *
 *   node seeddata/seedAnnualTestTeam3.js            # show the plan
 *   node seeddata/seedAnnualTestTeam3.js --apply    # create it
 *   node seeddata/seedAnnualTestTeam3.js --cleanup  # show what would be removed (add --apply to remove)
 *
 * Password for all four: TEST_PASSWORD below.
 */
import 'dotenv/config';
import bcrypt from 'bcryptjs';
import { prisma } from '../src/lib/prisma.js';

const DOMAIN = 'cityexpertcare.com';
const DEPARTMENT = 'Sales Operations';
const TEST_PASSWORD = 'Test@1234';
const SEED_TAG = 'seed:appraisal-test-3';
const APPLY = process.argv.includes('--apply');
const CLEANUP = process.argv.includes('--cleanup');
const FY = 'FY 2025-26';

const MANAGER = { name: 'Debasish Nayak', email: `debasish.nayak@${DOMAIN}`, designation: 'Sales Operations Manager', employeeId: 'CEC-SO-300' };
// Ratings for the 12 months Apr 2025 .. Mar 2026.
const MEMBERS = [
  { name: 'Sneha Mohapatra', email: `sneha.mohapatra@${DOMAIN}`, designation: 'Senior Sales Executive', employeeId: 'CEC-SO-301', ratings: [4.5, 5, 4.5, 4.5, 5, 4.5, 5, 5, 4.5, 4.5, 5, 5] },
  { name: 'Arjun Das', email: `arjun.das@${DOMAIN}`, designation: 'Sales Executive', employeeId: 'CEC-SO-302', ratings: [3, 3.5, 3, 3.5, 3.5, 3, 3.5, 4, 3.5, 3, 3.5, 3.5], late: true },
  { name: 'Pooja Behera', email: `pooja.behera@${DOMAIN}`, designation: 'Sales Executive', employeeId: 'CEC-SO-303', ratings: [3.5, 4, 4, 4, 4.5, 4, 4, 4.5, 4, 4.5, 4, 4.5] },
];

// month = 0-based calendar month; year computed from it (Apr–Dec 2025, Jan–Mar 2026).
const QUARTERS = [
  { quarter: 'Q1', label: 'Apr–Jun 2025', months: [3, 4, 5], title: 'New dealer onboarding' },
  { quarter: 'Q2', label: 'Jul–Sep 2025', months: [6, 7, 8], title: 'Quarterly sales target — East zone' },
  { quarter: 'Q3', label: 'Oct–Dec 2025', months: [9, 10, 11], title: 'Festive season campaign' },
  { quarter: 'Q4', label: 'Jan–Mar 2026', months: [0, 1, 2], title: 'Year-end collections and renewals' },
];
const WEIGHTS = [[15, 15], [15, 20], [15, 20]];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const WORK = [
  ['Onboard and train new dealers', 'Update the dealer CRM records'],
  ['Close orders against the monthly target', 'Send the weekly pipeline report'],
  ['Run campaign visits with key accounts', 'Track campaign leads to closure'],
  ['Collect outstanding payments', 'Renew annual maintenance contracts'],
];

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

  const find = (where) => prisma.tenantUser.findFirst({ where: { tenantId: tenant.id, isDeleted: false, ...where }, select: { id: true, name: true } });
  const cmd = await find({ role: 'CMD' });
  if (!cmd) throw new Error('No CMD found in the tenant');

  const active = await prisma.tenantUser.count({ where: { tenantId: tenant.id, isDeleted: false, status: { in: ['ACTIVE', 'INVITED'] } } });
  const missing = [];
  for (const e of emails) if (!(await prisma.tenantUser.findUnique({ where: { email: e } }))) missing.push(e);
  if (active + missing.length > (tenant.licenseLimit ?? 0)) throw new Error(`Not enough licenses: ${active}/${tenant.licenseLimit}, need ${missing.length}`);

  console.log(`Department: ${DEPARTMENT}`);
  console.log(`Manager: ${MANAGER.name} → reports to ${cmd.name}`);
  MEMBERS.forEach((m) => console.log(`Member:  ${m.name} <${m.email}>`));
  console.log(`Goal and task owner: ${MANAGER.name}`);
  console.log(`Users to create: ${missing.length} (licenses ${active}/${tenant.licenseLimit}). ${MEMBERS.length * 4} goals and ${MEMBERS.length * 24} tasks, all completed and rated. No appraisals.`);
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
  const people = [];
  for (const m of MEMBERS) people.push({ user: await upsertUser(m, 'EMPLOYEE', manager.id), ratings: m.ratings, late: m.late });

  let goals = 0;
  let tasks = 0;
  for (const person of people) {
    for (const [qi, q] of QUARTERS.entries()) {
      const owner = manager;
      const first = q.months[0];
      const last = q.months[2];
      const title = `${q.label}: ${q.title}`;
      let goal = await prisma.goal.findFirst({ where: { tenantId: tenant.id, employeeId: person.user.id, title } });
      if (!goal) {
        goal = await prisma.goal.create({
          data: {
            tenantId: tenant.id, employeeId: person.user.id, createdById: owner.id, createdBy: owner.name, ownerManagerId: owner.id, title,
            description: `${q.title} for ${q.label}. Goal owner: ${owner.name}. Seeded for annual appraisal testing.`,
            category: 'Sales Operations', priority: 'high', goalType: 'General', status: 'COMPLETED', approvalMode: 'MANAGER_APPROVAL',
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
