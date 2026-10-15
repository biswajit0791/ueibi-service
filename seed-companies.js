import { seedThreeCompanies } from './src/lib/seedCompanies.js';

seedThreeCompanies()
  .catch((err) => {
    console.error('❌ Error seeding companies:', err);
    process.exit(1);
  });
