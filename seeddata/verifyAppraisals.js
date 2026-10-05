import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  const tenant = await prisma.tenant.findFirst({ where: { domainName: 'usifdn.org' } });
  if (!tenant) {
    console.log('usifdn tenant not found');
    return;
  }

  const cycles = await prisma.appraisalCycle.findMany({
    where: { tenantId: tenant.id },
    include: {
      parameters: true,
      reviews: {
        include: {
          scores: true,
          employee: {
            select: { id: true, name: true, email: true, designation: true }
          }
        }
      },
      nominations: {
        include: { feedback: true }
      }
    },
    orderBy: { startDate: 'asc' }
  });

  console.log(`========================================`);
  console.log(`Tenant: usifdn (${tenant.id})`);
  console.log(`Total Cycles: ${cycles.length}`);
  
  const annualCycles = cycles.filter(c => c.frequency === 'ANNUAL');
  const quarterlyCycles = cycles.filter(c => c.frequency === 'QUARTERLY');
  const monthlyCycles = cycles.filter(c => c.frequency === 'MONTHLY');
  
  console.log(`Annual Cycles: ${annualCycles.length} ->`, annualCycles.map(c => c.name).join(', '));
  console.log(`Quarterly Cycles: ${quarterlyCycles.length} ->`, quarterlyCycles.map(c => c.name).join(', '));
  console.log(`Monthly Cycles: ${monthlyCycles.length} ->`, monthlyCycles.map(c => c.name).join(', '));
  
  const totalReviews = cycles.reduce((sum, c) => sum + c.reviews.length, 0);
  console.log(`Total Reviews Seeded: ${totalReviews}`);

  const sampleAnnual = annualCycles[0]?.reviews[0];
  if (sampleAnnual) {
    console.log(`\nSample Annual Review (${annualCycles[0].name}):`);
    console.log(` - Employee: ${sampleAnnual.employee?.name} (${sampleAnnual.employee?.designation})`);
    console.log(` - Status: ${sampleAnnual.status}`);
    console.log(` - Self Rating: ${sampleAnnual.selfRating}`);
    console.log(` - Manager Rating: ${sampleAnnual.managerRating}`);
    console.log(` - Hike Percentage: ${sampleAnnual.hikePercentage}%`);
    console.log(` - Promotion Recommended: ${sampleAnnual.promotionRecommended}`);
    console.log(` - Parameter Scores: ${sampleAnnual.scores.length}`);
    console.log(` - Cycle 360 Peer Nominations: ${annualCycles[0].nominations.length}`);
    if (annualCycles[0].nominations[0]?.feedback) {
      console.log(` - Sample Peer Feedback Strengths: "${annualCycles[0].nominations[0].feedback.strengths.substring(0, 55)}..."`);
    }
  }

  const sampleMonthly = monthlyCycles.find(c => c.name === 'October 2025')?.reviews[0];
  if (sampleMonthly) {
    console.log(`\nSample Monthly Review (${sampleMonthly.cycleId}):`);
    console.log(` - Employee ID: ${sampleMonthly.employeeId}`);
    console.log(` - Status: ${sampleMonthly.status}`);
    console.log(` - Self Rating: ${sampleMonthly.selfRating}`);
    console.log(` - Manager Rating: ${sampleMonthly.managerRating}`);
  }
}

main()
  .catch(console.error)
  .finally(async () => {
    await prisma.$disconnect();
  });
