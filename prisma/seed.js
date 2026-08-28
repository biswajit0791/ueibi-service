import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('Seeding initial data...');

  // 1. Create a default active Appraisal Cycle
  const cycle = await prisma.appraisalCycle.upsert({
    where: { id: 'default_cycle' },
    update: {},
    create: {
      id: 'default_cycle',
      name: 'Q3 FY 2026-27',
      startDate: new Date('2026-10-01'),
      endDate: new Date('2026-12-31'),
      status: 'ACTIVE',
    },
  });
  console.log('Created Appraisal Cycle:', cycle);

  // 2. Create seed coupons
  await prisma.coupon.upsert({
    where: { code: 'BDM100' },
    update: {},
    create: {
      code: 'BDM100',
      discountType: 'PERCENT',
      discountValue: 100.0,
      bdmName: 'Biswajit',
      active: true,
    },
  });

  await prisma.coupon.upsert({
    where: { code: 'BDM20' },
    update: {},
    create: {
      code: 'BDM20',
      discountType: 'PERCENT',
      discountValue: 20.0,
      bdmName: 'Biswajit',
      active: true,
    },
  });
  console.log('Created coupons: BDM100, BDM20');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
