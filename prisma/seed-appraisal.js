import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const DEFAULT_PARAMETERS = [
  { name: 'Technical Skills', order: 1 },
  { name: 'Conduct & Ethics', order: 2 },
  { name: 'Punctuality & Attendance', order: 3 },
  { name: 'Communication', order: 4 },
  { name: 'Teamwork & Collaboration', order: 5 },
];

// Round-robin spread of review statuses so a seeded cycle has a realistic mix
// (used only for the *current* cycle — the prior cycle is seeded fully COMPLETED/RELEASED).
const STATUS_CYCLE = ['DRAFT', 'SUBMITTED', 'MANAGER_REVIEWED', 'COMPLETED'];

function randomScore() {
  return Math.floor(Math.random() * 2) + 3; // 3-4, keeps seed data plausible
}

async function ensureParameters(tenantId, cycleId) {
  const existing = await prisma.appraisalParameter.findMany({ where: { cycleId } });
  if (existing.length > 0) return existing;

  await prisma.appraisalParameter.createMany({
    data: DEFAULT_PARAMETERS.map((p) => ({ tenantId, cycleId, name: p.name, order: p.order, isActive: true })),
  });
  return prisma.appraisalParameter.findMany({ where: { cycleId } });
}

async function seedReviewsForCycle(tenant, cycle, employees, { forceCompleted = false } = {}) {
  const parameters = await ensureParameters(tenant.id, cycle.id);
  let created = 0;

  for (let i = 0; i < employees.length; i++) {
    const employee = employees[i];

    const existing = await prisma.performanceReview.findFirst({
      where: { cycleId: cycle.id, employeeId: employee.id },
    });
    if (existing) continue;

    const status = forceCompleted ? 'COMPLETED' : STATUS_CYCLE[i % STATUS_CYCLE.length];
    const reachedManager = forceCompleted || status === 'MANAGER_REVIEWED' || status === 'COMPLETED';
    const reachedSelf = forceCompleted || status !== 'DRAFT';
    const isCompleted = status === 'COMPLETED';

    const review = await prisma.performanceReview.create({
      data: {
        cycleId: cycle.id,
        employeeId: employee.id,
        status,
        ...(reachedSelf && {
          selfAccomplishments: 'Delivered key initiatives on schedule and supported the team through the review period.',
          selfWeaknesses: 'Looking to improve cross-team communication and documentation habits.',
          selfSubmittedAt: new Date(),
        }),
        ...(reachedManager && {
          managerRemarks: 'Consistent contributor; met expectations across core responsibilities this cycle.',
          managerSubmittedAt: new Date(),
        }),
        ...(isCompleted && {
          hikePercentage: [0, 5, 8, 10, 12][i % 5],
          hrSignoffStatus: forceCompleted ? 'RELEASED' : (i % 2 === 0 ? 'RELEASED' : 'PENDING_RELEASE'),
          hrRemarks: 'Reviewed and confirmed by HR.',
          ...(forceCompleted || i % 2 === 0 ? { hrSignedOffById: employee.managerId || employee.id, hrSignedOffAt: new Date() } : {}),
        }),
      },
    });

    await prisma.reviewScore.createMany({
      data: parameters.map((param) => ({
        reviewId: review.id,
        parameterId: param.id,
        ...(reachedSelf && { selfScore: randomScore() }),
        ...(reachedManager && { managerScore: randomScore() }),
        ...(isCompleted && { hrScore: randomScore() }),
      })),
    });

    created += 1;
  }

  return created;
}

async function main() {
  console.log('Seeding appraisal cycles, parameters, and sample reviews...');

  const tenants = await prisma.tenant.findMany();
  console.log(`Found ${tenants.length} tenants.`);

  if (tenants.length === 0) {
    console.log('No tenants found. Seeding will run when tenants register.');
    return;
  }

  for (const tenant of tenants) {
    let activeCycle = await prisma.appraisalCycle.findFirst({
      where: { tenantId: tenant.id, status: 'ACTIVE' },
    });

    if (!activeCycle) {
      activeCycle = await prisma.appraisalCycle.create({
        data: {
          tenantId: tenant.id,
          name: 'FY 2024-2025',
          frequency: 'ANNUAL',
          startDate: new Date('2024-04-01'),
          endDate: new Date('2025-03-31'),
          status: 'ACTIVE',
        },
      });
      console.log(`Created active AppraisalCycle for tenant ${tenant.companyName || tenant.id}: ${activeCycle.name}`);
    } else {
      console.log(`Found active AppraisalCycle for tenant ${tenant.companyName || tenant.id}: ${activeCycle.name}`);
    }
    await ensureParameters(tenant.id, activeCycle.id);

    // A prior, closed cycle so the year/cycle picker has real history to browse.
    let priorCycle = await prisma.appraisalCycle.findFirst({
      where: { tenantId: tenant.id, name: 'FY 2023-2024' },
    });
    if (!priorCycle) {
      priorCycle = await prisma.appraisalCycle.create({
        data: {
          tenantId: tenant.id,
          name: 'FY 2023-2024',
          frequency: 'ANNUAL',
          startDate: new Date('2023-04-01'),
          endDate: new Date('2024-03-31'),
          status: 'CLOSED',
        },
      });
      console.log(`Created prior CLOSED AppraisalCycle for tenant ${tenant.companyName || tenant.id}: ${priorCycle.name}`);
    }

    const employees = await prisma.tenantUser.findMany({
      where: { tenantId: tenant.id, status: 'ACTIVE', isDeleted: false },
      take: 12,
      orderBy: { createdAt: 'asc' },
    });

    if (employees.length === 0) {
      console.log(`  No active employees for tenant ${tenant.companyName || tenant.id} — skipping sample reviews.`);
      continue;
    }

    const createdActive = await seedReviewsForCycle(tenant, activeCycle, employees);
    console.log(`  + Seeded ${createdActive} sample review(s) for the active cycle.`);

    const createdPrior = await seedReviewsForCycle(tenant, priorCycle, employees, { forceCompleted: true });
    console.log(`  + Seeded ${createdPrior} sample review(s) for the prior closed cycle.`);
  }

  console.log('Appraisal seed completed successfully.');
}

main()
  .catch((e) => {
    console.error('Error seeding appraisal:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
