import { prisma } from '../src/lib/prisma.js';

async function main() {
  console.log('Starting Master Data tables migration...');

  // 1. Create city_masters table
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "city_masters" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "name" TEXT NOT NULL,
      "state" TEXT NOT NULL,
      "country" TEXT NOT NULL DEFAULT 'India',
      "isActive" BOOLEAN NOT NULL DEFAULT true,
      "createdBy" TEXT,
      "updatedBy" TEXT,
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);
  await prisma.$executeRawUnsafe(`
    CREATE UNIQUE INDEX IF NOT EXISTS "city_masters_name_state_country_key" ON "city_masters"("name", "state", "country");
  `);
  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS "city_masters_isActive_idx" ON "city_masters"("isActive");
  `);
  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS "city_masters_state_idx" ON "city_masters"("state");
  `);

  // 2. Create industry_masters table
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "industry_masters" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "name" TEXT NOT NULL,
      "description" TEXT,
      "isActive" BOOLEAN NOT NULL DEFAULT true,
      "createdBy" TEXT,
      "updatedBy" TEXT,
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);
  await prisma.$executeRawUnsafe(`
    CREATE UNIQUE INDEX IF NOT EXISTS "industry_masters_name_key" ON "industry_masters"("name");
  `);
  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS "industry_masters_isActive_idx" ON "industry_masters"("isActive");
  `);

  // 3. Create subscription_duration_masters table
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "subscription_duration_masters" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "name" TEXT NOT NULL,
      "years" INTEGER NOT NULL,
      "months" INTEGER NOT NULL,
      "displayOrder" INTEGER NOT NULL DEFAULT 0,
      "isActive" BOOLEAN NOT NULL DEFAULT true,
      "createdBy" TEXT,
      "updatedBy" TEXT,
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);
  await prisma.$executeRawUnsafe(`
    CREATE UNIQUE INDEX IF NOT EXISTS "subscription_duration_masters_years_key" ON "subscription_duration_masters"("years");
  `);
  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS "subscription_duration_masters_isActive_idx" ON "subscription_duration_masters"("isActive");
  `);
  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS "subscription_duration_masters_displayOrder_idx" ON "subscription_duration_masters"("displayOrder");
  `);

  // 4. Add columns to coupons table
  await prisma.$executeRawUnsafe(`
    ALTER TABLE "coupons" ADD COLUMN IF NOT EXISTS "cityId" TEXT;
  `);
  await prisma.$executeRawUnsafe(`
    ALTER TABLE "coupons" ADD COLUMN IF NOT EXISTS "industryId" TEXT;
  `);
  await prisma.$executeRawUnsafe(`
    ALTER TABLE "coupons" ADD COLUMN IF NOT EXISTS "subscriptionDurationId" TEXT;
  `);

  // Add foreign keys if not exists
  await prisma.$executeRawUnsafe(`
    DO $$ BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'coupons_cityId_fkey'
      ) THEN
        ALTER TABLE "coupons"
          ADD CONSTRAINT "coupons_cityId_fkey"
          FOREIGN KEY ("cityId") REFERENCES "city_masters"("id") ON DELETE SET NULL ON UPDATE CASCADE;
      END IF;
    END $$;
  `);

  await prisma.$executeRawUnsafe(`
    DO $$ BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'coupons_industryId_fkey'
      ) THEN
        ALTER TABLE "coupons"
          ADD CONSTRAINT "coupons_industryId_fkey"
          FOREIGN KEY ("industryId") REFERENCES "industry_masters"("id") ON DELETE SET NULL ON UPDATE CASCADE;
      END IF;
    END $$;
  `);

  await prisma.$executeRawUnsafe(`
    DO $$ BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'coupons_subscriptionDurationId_fkey'
      ) THEN
        ALTER TABLE "coupons"
          ADD CONSTRAINT "coupons_subscriptionDurationId_fkey"
          FOREIGN KEY ("subscriptionDurationId") REFERENCES "subscription_duration_masters"("id") ON DELETE SET NULL ON UPDATE CASCADE;
      END IF;
    END $$;
  `);

  console.log('Master Data tables and coupon foreign keys successfully created/verified.');
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error('Migration failed:', e);
    process.exit(1);
  });
