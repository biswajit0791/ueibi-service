/**
 * @file seedAppraisalTestTeam.js
 * @description Seeds a small "Customer Success" team in cityexpertcare.com to
 * test Monthly and Quarterly appraisals end to end.
 *
 *   Manager  Ritesh Panda (MANAGER) → reports to the CMD
 *   Members  5 employees reporting to Ritesh
 *
 * Every member gets one goal per quarter of 2026 so far (Jan–Mar, Apr–Jun,
 * Jul–Sep), each with two tasks per month (weights total 100 per goal). Past
 * tasks are done and rated by Ritesh (1–5, half steps), with a few Final
 * Weightage downgrades for late delivery — exactly what the Team table and
 * the appraisal read. October tasks are in progress and unrated (Q3 has not
 * ended). Tanmay has no May tasks, to check that the quarterly average skips
 * an empty month. Ritesh has his own goals, rated by the CMD, so the
 * manager's own self-appraisal can be tested too.
 *
 * Dry run by default. Safe to re-run (skips what already exists).
 *
 *   node seeddata/seedAppraisalTestTeam.js            # show what would be created
 *   node seeddata/seedAppraisalTestTeam.js --apply    # create it
 *   node seeddata/seedAppraisalTestTeam.js --cleanup  # remove everything this script created
 *
 * All seeded users sign in with the password in TEST_PASSWORD below.
 */
import 'dotenv/config';
import bcrypt from 'bcryptjs';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const DOMAIN = 'cityexpertcare.com';
const DEPARTMENT = 'Customer Success';
const TEST_PASSWORD = 'Test@1234';
const SEED_TAG = 'seed:appraisal-test';
const APPLY = process.argv.includes('--apply');
const CLEANUP = process.argv.includes('--cleanup');
const YEAR = 2026;

const MANAGER = { name: 'Ritesh Panda', email: `ritesh.panda@${DOMAIN}`, designation: 'Customer Success Manager', employeeId: 'CEC-CS-100' };

// ratings: one per month Jan..Sep (index 0..8). null = no tasks that month.
const MEMBERS = [
  { name: 'Ipsita Rath', email: `ipsita.rath@${DOMAIN}`, designation: 'Senior CS Executive', employeeId: 'CEC-CS-101', ratings: [4.5, 5, 4.5, 4.5, 5, 5, 4.5, 5, 4.5] },
  { name: 'Bikash Swain', email: `bikash.swain@${DOMAIN}`, designation: 'CS Executive', employeeId: 'CEC-CS-102', ratings: [3.5, 4, 3.5, 4, 3.5, 4, 4, 3.5, 4] },
  { name: 'Lipika Nanda', email: `lipika.nanda@${DOMAIN}`, designation: 'CS Executive', employeeId: 'CEC-CS-103', ratings: [3, 4, 4.5, 2.5, 3.5, 5, 3, 4, 4.5] },
  { name: 'Subham Behera', email: `subham.behera@${DOMAIN}`, designation: 'Associate CS Executive', employeeId: 'CEC-CS-104', ratings: [2.5, 3, 2.5, 3, 2.5, 3, 3, 2.5, 3], late: true },
  { name: 'Tanmay Mishra', email: `tanmay.mishra@${DOMAIN}`, designation: 'Associate CS Executive', employeeId: 'CEC-CS-105', ratings: [4, 3.5, 4, 4, null, 3.5, 4, 4, 3.5] },
];
const MANAGER_RATINGS = [4, 4.5, 4, 4.5, 4, 4.5, 4, 4.5, 4];

// Calendar quarters of 2026 used for goals (FY Apr–Mar: Jan–Mar is Q4 FY 2025-26).
const QUARTERS = [
  { label: 'Jan–Mar 2026', months: [0, 1, 2], fy: 'FY 2025-26', quarter: 'Q4' },
  { label: 'Apr–Jun 2026', months: [3, 4, 5], fy: 'FY 2026-27', quarter: 'Q1' },
  { label: 'Jul–Sep 2026', months: [6, 7, 8], fy: 'FY 2026-27', quarter: 'Q2' },
];
// Two tasks a month; weights per goal total 100.
const WEIGHTS = [[15, 15], [15, 20], [15, 20]];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October'];
const WORK = [
  ['Resolve priority tickets within SLA', 'Update knowledge-base articles'],
  ['Run customer onboarding calls', 'Prepare monthly CSAT report'],
  ['Close escalated complaints', 'Review renewal-risk accounts'],
];

const utc = (m, d) => new Date(Date.UTC(YEAR, m, d));
const addDays = (date, n) => new Date(date.getTime() + n * 86400000);
const clamp = (r) => Math.min(5, Math.max(1, r));

async function main() {
  const tenant = await prisma.tenant.findFirst({ where: { domainName: DOMAIN }, select: { id: true, companyName: true, licenseLimit: true } });
  if (!tenant) throw new Error(`Tenant ${DOMAIN} not found`);
  const emails = [MANAGER.email, ...MEMBERS.map((m) => m.email)];
  console.log(`Tenant: ${tenant.companyName} (${DOMAIN})  mode: ${CLEANUP ? 'CLEANUP' : APPLY ? 'APPLY' : 'DRY RUN'}\n`);

  if (CLEANUP) return cleanup(tenant, emails);

  const cmd = await prisma.tenantUser.findFirst({ where: { tenantId: tenant.id, role: 'CMD', isDeleted: false }, select: { id: true, name: true } });
  if (!cmd) throw new Error('No CMD found to be the manager\'s manager / goal owner');
  const hr = await prisma.tenantUser.findFirst({ where: { tenantId: tenant.id, role: 'HR', isDeleted: false }, select: { id: true, name: true, email: true } });

  const active = await prisma.tenantUser.count({ where: { tenantId: tenant.id, isDeleted: false, status: { in: ['ACTIVE', 'INVITED'] } } });
  const toCreate = [];
  for (const e of emails) if (!(await prisma.tenantUser.findUnique({ where: { email: e } }))) toCreate.push(e);
  if (active + toCreate.length > (tenant.licenseLimit ?? 0)) throw new Error(`Not enough licenses: ${active} used of ${tenant.licenseLimit}, need ${toCreate.length} more`);

  console.log(`Department: ${DEPARTMENT}`);
  console.log(`Manager:    ${MANAGER.name} <${MANAGER.email}> → reports to ${cmd.name}`);
  MEMBERS.forEach((m) => console.log(`Member:     ${m.name} <${m.email}>`));
  console.log(`\nUsers to create: ${toCreate.length} (licenses ${active}/${tenant.licenseLimit})`);
  console.log(`Goals: 3 per person (Jan–Mar, Apr–Jun, Jul–Sep) + Oct in-progress tasks. HR to review: ${hr ? `${hr.name} <${hr.email}>` : 'none found'}`);
  if (!APPLY) {
    console.log('\nDry run — nothing written. Re-run with --apply.');
    return;
  }

  const passwordHash = await bcrypt.hash(TEST_PASSWORD, 10);
  const dept = await prisma.department.findFirst({ where: { tenantId: tenant.id, name: DEPARTMENT } });
  if (!dept) await prisma.department.create({ data: { tenantId: tenant.id, name: DEPARTMENT } });

  const upsertUser = async (p, role, managerId) => {
    const existing = await prisma.tenantUser.findUnique({ where: { email: p.email } });
    if (existing) {
      if (existing.tenantId !== tenant.id) throw new Error(`${p.email} exists in another tenant`);
      return existing;
    }
    return prisma.tenantUser.create({
      data: {
        tenantId: tenant.id, email: p.email, name: p.name, passwordHash, role, status: 'ACTIVE',
        mustChangePassword: false, department: DEPARTMENT, designation: p.designation,
        employeeId: p.employeeId, managerId, joinDate: utc(0, 2),
      },
    });
  };

  const manager = await upsertUser(MANAGER, 'MANAGER', cmd.id);
  const members = [];
  for (const m of MEMBERS) members.push({ ...m, user: await upsertUser(m, 'EMPLOYEE', manager.id) });

  let goals = 0;
  let tasks = 0;
  const seedPerson = async (person, ratings, rater, late) => {
    for (const [qi, q] of QUARTERS.entries()) {
      const title = `${q.label}: Customer success targets`;
      let goal = await prisma.goal.findFirst({ where: { tenantId: tenant.id, employeeId: person.id, title } });
      if (!goal) {
        goal = await prisma.goal.create({
          data: {
            tenantId: tenant.id, employeeId: person.id, createdById: rater.id, createdBy: rater.name,
            ownerManagerId: rater.id, title,
            description: `Quarterly customer success goal (${q.label}). Seeded for appraisal testing.`,
            category: 'Customer Success', priority: 'high', goalType: 'General', status: 'COMPLETED',
            approvalMode: 'MANAGER_APPROVAL', progress: 100, financialYear: q.fy, quarter: q.quarter,
            startDate: utc(q.months[0], 1), targetDate: utc(q.months[2] + 1, 0), dueDate: utc(q.months[2] + 1, 0),
            milestones: 6, completedMilestones: 6, weightLockExempt: false,
          },
        });
        await prisma.goalAssignment.create({
          data: { tenantId: tenant.id, goalId: goal.id, employeeId: person.id, assignedById: rater.id, status: 'COMPLETED', progress: 100 },
        }).catch(() => {});
        goals += 1;
      }
      for (const [mi, month] of q.months.entries()) {
        const rating = ratings[month];
        if (rating === null) continue; // deliberately empty month
        for (const [ti, weight] of WEIGHTS[mi].entries()) {
          const taskTitle = `${WORK[qi][ti]} — ${MONTHS[month]}`;
          if (await prisma.task.findFirst({ where: { tenantId: tenant.id, employeeId: person.id, title: taskTitle } })) continue;
          const due = utc(month, ti === 0 ? 12 : 25);
          const isLate = late && ti === 1 && mi !== 0;
          const done = isLate ? addDays(due, 4) : due;
          const taskRating = clamp(ti === 0 ? rating : rating - (rating >= 4.5 ? 0.5 : 0));
          await prisma.task.create({
            data: {
              tenantId: tenant.id, employeeId: person.id, goalId: goal.id, title: taskTitle,
              description: `Seeded task for appraisal testing (${MONTHS[month]} ${YEAR}).`,
              priority: 'medium', status: 'done', progress: 100, weight,
              startDate: addDays(due, -8), dueDate: due, actualStartDate: addDays(due, -8), actualCompletionDate: done,
              financialYear: q.fy, tags: SEED_TAG, isPrivate: false, isStandalone: false,
              managerRating: taskRating, managerRatingNotes: taskRating >= 4.5 ? 'Excellent work.' : taskRating >= 3.5 ? 'Good, on track.' : 'Needs improvement.',
              managerRatedById: rater.id, managerRatedAt: addDays(done, 1),
              ...(isLate && {
                managerFinalWeight: weight - 5, weightAdjustedById: rater.id, weightAdjustedAt: addDays(done, 1),
                weightAdjustReason: 'Delivered 4 days after the due date.',
              }),
            },
          });
          tasks += 1;
        }
      }
    }
    // October: in progress, not rated (Q3 / October appraisals not open yet).
    const octTitle = 'Oct–Dec 2026: Customer success targets';
    let oct = await prisma.goal.findFirst({ where: { tenantId: tenant.id, employeeId: person.id, title: octTitle } });
    if (!oct) {
      oct = await prisma.goal.create({
        data: {
          tenantId: tenant.id, employeeId: person.id, createdById: rater.id, createdBy: rater.name, ownerManagerId: rater.id,
          title: octTitle, description: 'Current quarter goal. Seeded for appraisal testing.', category: 'Customer Success',
          priority: 'high', goalType: 'General', status: 'ACTIVE', approvalMode: 'MANAGER_APPROVAL', progress: 40,
          financialYear: 'FY 2026-27', quarter: 'Q3', startDate: utc(9, 1), targetDate: utc(12, 0), dueDate: utc(12, 0),
          milestones: 2, completedMilestones: 0, weightLockExempt: false,
        },
      });
      await prisma.goalAssignment.create({ data: { tenantId: tenant.id, goalId: oct.id, employeeId: person.id, assignedById: rater.id, status: 'IN_PROGRESS', progress: 40 } }).catch(() => {});
      goals += 1;
      for (const [ti, w] of [50, 50].entries()) {
        await prisma.task.create({
          data: {
            tenantId: tenant.id, employeeId: person.id, goalId: oct.id, title: `${WORK[0][ti]} — October`,
            priority: 'medium', status: 'in_progress', progress: 40, weight: w, startDate: utc(9, 1), dueDate: utc(9, 28 + ti),
            actualStartDate: utc(9, 2), financialYear: 'FY 2026-27', tags: SEED_TAG, isPrivate: false, isStandalone: false,
          },
        });
        tasks += 1;
      }
    }
  };

  for (const m of members) await seedPerson(m.user, m.ratings, manager, m.late);
  await seedPerson(manager, MANAGER_RATINGS, cmd, false);

  console.log(`\nCreated: goals ${goals}, tasks ${tasks}.`);
  console.log(`Sign in as any of: ${emails.join(', ')}  (password: ${TEST_PASSWORD})`);
}

async function cleanup(tenant, emails) {
  const users = await prisma.tenantUser.findMany({ where: { tenantId: tenant.id, email: { in: emails } }, select: { id: true, email: true } });
  const ids = users.map((u) => u.id);
  const counts = {
    reviews: await prisma.performanceReview.count({ where: { employeeId: { in: ids } } }),
    tasks: await prisma.task.count({ where: { tenantId: tenant.id, employeeId: { in: ids } } }),
    goals: await prisma.goal.count({ where: { tenantId: tenant.id, employeeId: { in: ids } } }),
  };
  console.log(`Would remove ${users.length} users, ${counts.goals} goals, ${counts.tasks} tasks, ${counts.reviews} appraisal reviews.`);
  if (!APPLY) {
    console.log('Dry run — re-run with --cleanup --apply to delete.');
    return;
  }
  await prisma.performanceReview.deleteMany({ where: { employeeId: { in: ids } } });
  await prisma.task.deleteMany({ where: { tenantId: tenant.id, employeeId: { in: ids } } });
  await prisma.goalAssignment.deleteMany({ where: { tenantId: tenant.id, employeeId: { in: ids } } });
  await prisma.goal.deleteMany({ where: { tenantId: tenant.id, employeeId: { in: ids } } });
  await prisma.notification.deleteMany({ where: { recipientId: { in: ids } } }).catch(() => {});
  // Soft-delete: other records (audit, notifications to HR) may still reference these users.
  await prisma.tenantUser.updateMany({ where: { id: { in: ids } }, data: { isDeleted: true, status: 'EXITED' } });
  console.log('Removed.');
}

main()
  .catch((err) => { console.error(err.message); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
