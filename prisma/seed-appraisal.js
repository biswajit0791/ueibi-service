import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const DEFAULT_PARAMETERS = [
  { name: 'Technical Skills', order: 1 },
  { name: 'Conduct & Ethics', order: 2 },
  { name: 'Punctuality & Attendance', order: 3 },
  { name: 'Communication', order: 4 },
  { name: 'Teamwork & Collaboration', order: 5 },
];

async function main() {
  console.log('Seeding appraisal cycle and parameters...');

  const tenants = await prisma.tenant.findMany();
  console.log(`Found ${tenants.length} tenants.`);

  if (tenants.length === 0) {
    console.log('No tenants found. Seeding will run when tenants register.');
    return;
  }

  for (const tenant of tenants) {
    let cycle = await prisma.appraisalCycle.findFirst({
      where: {
        tenantId: tenant.id,
        status: 'ACTIVE',
      },
    });

    if (!cycle) {
      cycle = await prisma.appraisalCycle.create({
        data: {
          tenantId: tenant.id,
          name: 'FY 2024-2025',
          frequency: 'ANNUAL',
          startDate: new Date('2024-04-01'),
          endDate: new Date('2025-03-31'),
          status: 'ACTIVE',
        },
      });
      console.log(`Created AppraisalCycle for tenant ${tenant.companyName || tenant.id}: ${cycle.name}`);
    } else {
      console.log(`Found active AppraisalCycle for tenant ${tenant.companyName || tenant.id}: ${cycle.name}`);
    }

    // Seed 5 parameters
    for (const param of DEFAULT_PARAMETERS) {
      const existing = await prisma.appraisalParameter.findFirst({
        where: {
          cycleId: cycle.id,
          name: param.name,
        },
      });

      if (!existing) {
        await prisma.appraisalParameter.create({
          data: {
            tenantId: tenant.id,
            cycleId: cycle.id,
            name: param.name,
            order: param.order,
            isActive: true,
          },
        });
        console.log(`  + Added parameter: ${param.name}`);
      }
    }
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
