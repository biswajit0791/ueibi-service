import { seedThreeCompanies } from './src/lib/seedCompanies.js';
import { prisma } from './src/lib/prisma.js';

seedThreeCompanies()
  .catch((err) => {
    console.error('❌ Error seeding companies:', err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
