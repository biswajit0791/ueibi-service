import 'dotenv/config';
import pg from 'pg';
const { Client } = pg;

const client = new Client({ connectionString: process.env.DATABASE_URL });

async function resolveMigration() {
  try {
    await client.connect();
    console.log('Connected to database.');

    // 1. Ensure table platform_branding exists
    await client.query(`
      CREATE TABLE IF NOT EXISTS "platform_branding" (
        "id" TEXT NOT NULL DEFAULT 'singleton',
        "platformName" TEXT NOT NULL DEFAULT 'UEIBI',
        "tagline" TEXT NOT NULL DEFAULT 'Enterprise Operations & Governance',
        "badgeText" TEXT NOT NULL DEFAULT 'ENTERPRISE HUB',
        "logoUrl" TEXT,
        "logoDarkUrl" TEXT,
        "iconUrl" TEXT,
        "faviconUrl" TEXT,
        "primaryColor" TEXT NOT NULL DEFAULT '#4f46e5',
        "gradientStart" TEXT NOT NULL DEFAULT '#4f46e5',
        "gradientEnd" TEXT NOT NULL DEFAULT '#3b82f6',
        "copyrightText" TEXT NOT NULL DEFAULT 'UEIBI Platform Inc. All rights reserved.',
        "updatedById" TEXT,
        "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "platform_branding_pkey" PRIMARY KEY ("id")
      );
    `);
    console.log('Table platform_branding verified.');

    // 2. Check _prisma_migrations table
    const checkRes = await client.query(
      `SELECT id, migration_name, finished_at, rolled_back_at FROM "_prisma_migrations" WHERE migration_name LIKE '%platform_branding%'`
    );

    if (checkRes.rows.length > 0) {
      console.log('Found migration row in _prisma_migrations:', checkRes.rows[0]);
      // Update the failed migration row to marked as finished
      await client.query(`
        UPDATE "_prisma_migrations"
        SET finished_at = NOW(),
            applied_steps_count = 1,
            logs = NULL,
            rolled_back_at = NULL
        WHERE migration_name LIKE '%platform_branding%'
      `);
      console.log('Successfully updated _prisma_migrations: marked 20261007120000_platform_branding as applied!');
    } else {
      console.log('No migration row found in _prisma_migrations. Inserting completed record...');
      await client.query(`
        INSERT INTO "_prisma_migrations"
          (id, checksum, finished_at, migration_name, logs, rolled_back_at, started_at, applied_steps_count)
        VALUES
          (gen_random_uuid()::text, '', NOW(), '20261007120000_platform_branding', NULL, NULL, NOW(), 1)
      `);
      console.log('Inserted applied migration record.');
    }

    await client.end();
    console.log('Done! prisma migrate deploy will now succeed.');
  } catch (err) {
    console.error('Error resolving migration:', err);
    process.exit(1);
  }
}

resolveMigration();
