import { prisma } from '../src/lib/prisma.js';
import crypto from 'crypto';

const cuid = () => 'cm' + crypto.randomBytes(12).toString('hex').slice(0, 23);

async function seed() {
  console.log('Seeding initial Master Data...');

  // 1. Subscription Durations
  const defaultDurations = [
    { name: '1 Year', years: 1, months: 12, displayOrder: 1, isActive: true },
    { name: '2 Years', years: 2, months: 24, displayOrder: 2, isActive: true },
    { name: '3 Years', years: 3, months: 36, displayOrder: 3, isActive: true },
  ];

  for (const d of defaultDurations) {
    const rows = await prisma.$queryRawUnsafe(`SELECT id FROM "subscription_duration_masters" WHERE "years" = $1`, d.years);
    const existing = rows && rows[0];

    if (!existing) {
      const id = cuid();
      await prisma.$executeRawUnsafe(
        `INSERT INTO "subscription_duration_masters" ("id", "name", "years", "months", "displayOrder", "isActive", "createdAt", "updatedAt")
         VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())`,
        id, d.name, d.years, d.months, d.displayOrder, d.isActive
      );
      console.log(`Inserted duration: ${d.name}`);
    }
  }

  // 2. Industries
  const defaultIndustries = [
    { name: 'Technology & Software', description: 'IT services, software development, cloud computing and tech solutions' },
    { name: 'Manufacturing & Industrial', description: 'Heavy industries, machinery, production and factories' },
    { name: 'Banking, Financial Services & Insurance (BFSI)', description: 'Banks, NBFCs, fintech, insurance and asset management' },
    { name: 'Healthcare & Pharmaceuticals', description: 'Hospitals, medical devices, biotechnology and pharma companies' },
    { name: 'Retail & E-Commerce', description: 'Online marketplaces, retail chains and consumer goods' },
    { name: 'Education & EdTech', description: 'Schools, colleges, universities and online educational platforms' },
    { name: 'Real Estate & Construction', description: 'Builders, property development and architecture infrastructure' },
    { name: 'Logistics & Supply Chain', description: 'Freight, warehousing, 3PL and shipping services' },
    { name: 'Professional & Consulting Services', description: 'Management consulting, legal, accounting and auditing' },
    { name: 'Media & Entertainment', description: 'Broadcasting, publishing, gaming, film and digital media' },
    { name: 'Hospitality & Tourism', description: 'Hotels, resorts, travel agencies and restaurants' },
    { name: 'Automotive & Mobility', description: 'Vehicle manufacturers, EVs, auto components and transport' },
    { name: 'Energy & Utilities', description: 'Power generation, renewable energy, oil & gas and utilities' },
    { name: 'Telecommunications', description: 'Telecom operators, networking hardware and communications' },
    { name: 'Non-Profit & NGO', description: 'Charities, social organizations, trusts and non-profits' },
    { name: 'Other', description: 'Other specialized or multi-sector enterprises' },
  ];

  for (const ind of defaultIndustries) {
    const rows = await prisma.$queryRawUnsafe(
      `SELECT id FROM "industry_masters" WHERE LOWER("name") = LOWER($1)`,
      ind.name
    );
    if (!rows || rows.length === 0) {
      const id = cuid();
      await prisma.$executeRawUnsafe(
        `INSERT INTO "industry_masters" ("id", "name", "description", "isActive", "createdAt", "updatedAt")
         VALUES ($1, $2, $3, true, NOW(), NOW())`,
        id, ind.name, ind.description
      );
      console.log(`Inserted industry: ${ind.name}`);
    }
  }

  // 3. Cities
  const defaultCities = [
    { name: 'Mumbai', state: 'Maharashtra', country: 'India' },
    { name: 'Bengaluru', state: 'Karnataka', country: 'India' },
    { name: 'Hyderabad', state: 'Telangana', country: 'India' },
    { name: 'Delhi', state: 'Delhi', country: 'India' },
    { name: 'New Delhi', state: 'Delhi', country: 'India' },
    { name: 'Pune', state: 'Maharashtra', country: 'India' },
    { name: 'Chennai', state: 'Tamil Nadu', country: 'India' },
    { name: 'Kolkata', state: 'West Bengal', country: 'India' },
    { name: 'Ahmedabad', state: 'Gujarat', country: 'India' },
    { name: 'Gurugram', state: 'Haryana', country: 'India' },
    { name: 'Noida', state: 'Uttar Pradesh', country: 'India' },
    { name: 'Jaipur', state: 'Rajasthan', country: 'India' },
    { name: 'Kochi', state: 'Kerala', country: 'India' },
    { name: 'Bhubaneswar', state: 'Odisha', country: 'India' },
    { name: 'Indore', state: 'Madhya Pradesh', country: 'India' },
    { name: 'Surat', state: 'Gujarat', country: 'India' },
    { name: 'Chandigarh', state: 'Chandigarh', country: 'India' },
    { name: 'Lucknow', state: 'Uttar Pradesh', country: 'India' },
    { name: 'Coimbatore', state: 'Tamil Nadu', country: 'India' },
    { name: 'Nagpur', state: 'Maharashtra', country: 'India' },
    { name: 'Visakhapatnam', state: 'Andhra Pradesh', country: 'India' },
  ];

  for (const c of defaultCities) {
    const rows = await prisma.$queryRawUnsafe(
      `SELECT id FROM "city_masters" WHERE LOWER("name") = LOWER($1) AND LOWER("state") = LOWER($2) AND LOWER("country") = LOWER($3)`,
      c.name, c.state, c.country
    );
    if (!rows || rows.length === 0) {
      const id = cuid();
      await prisma.$executeRawUnsafe(
        `INSERT INTO "city_masters" ("id", "name", "state", "country", "isActive", "createdAt", "updatedAt")
         VALUES ($1, $2, $3, $4, true, NOW(), NOW())`,
        id, c.name, c.state, c.country
      );
      console.log(`Inserted city: ${c.name}, ${c.state}`);
    }
  }

  console.log('Master Data seeding completed successfully.');
}

seed()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error('Seeding failed:', e);
    process.exit(1);
  });
