import { prisma } from './prisma.js';
import { execSync } from 'node:child_process';
import path from 'node:path';

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
];

/**
 * Ensures required columns exist in PostgreSQL tables without requiring CLI migrations.
 * Idempotently executes ALTER TABLE IF NOT EXISTS and backfills legacy records.
 */
export async function ensureAppraisalColumns() {
  try {
    // 0. Auto-generate Prisma Client if year/month fields are not in runtime model
    try {
      const prismaBin = path.resolve(process.cwd(), 'node_modules', 'prisma', 'build', 'index.js');
      console.log('[dbInit] Ensuring Prisma Client is generated with year/month fields...');
      const output = execSync(`node "${prismaBin}" generate`, { encoding: 'utf8' });
      console.log('[dbInit] prisma generate succeeded:\n', output);
    } catch (genErr) {
      console.warn('[dbInit] prisma generate note:', genErr?.message || genErr);
    }

    // 1. Add columns to appraisal_cycles table if missing
    await prisma.$executeRawUnsafe(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns 
          WHERE table_name = 'appraisal_cycles' AND column_name = 'year'
        ) THEN
          ALTER TABLE "appraisal_cycles" ADD COLUMN "year" INTEGER;
        END IF;

        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns 
          WHERE table_name = 'appraisal_cycles' AND column_name = 'month'
        ) THEN
          ALTER TABLE "appraisal_cycles" ADD COLUMN "month" VARCHAR(50);
        END IF;

        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns 
          WHERE table_name = 'appraisal_cycles' AND column_name = 'monthNumber'
        ) THEN
          ALTER TABLE "appraisal_cycles" ADD COLUMN "monthNumber" INTEGER;
        END IF;

        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns 
          WHERE table_name = 'appraisal_cycles' AND column_name = 'createdById'
        ) THEN
          ALTER TABLE "appraisal_cycles" ADD COLUMN "createdById" TEXT;
        END IF;
      END $$;
    `);

    // 2. Create index on (tenantId, year, month)
    try {
      await prisma.$executeRawUnsafe(`
        CREATE INDEX IF NOT EXISTS "appraisal_cycles_tenant_year_month_idx" 
        ON "appraisal_cycles"("tenantId", "year", "month");
      `);
    } catch {
      // index might already exist
    }

    // 3. Backfill any existing cycles where year is null
    const legacyCycles = await prisma.$queryRawUnsafe(`
      SELECT id, name, frequency, "startDate" FROM "appraisal_cycles" WHERE "year" IS NULL
    `);

    if (Array.isArray(legacyCycles) && legacyCycles.length > 0) {
      for (const c of legacyCycles) {
        let yr = null;
        let mth = null;
        let mthNum = null;

        // Try extracting year from name, e.g. "March 2026" or "FY 2024-2025"
        const yearMatch = c.name?.match(/\b(20\d\d)\b/);
        if (yearMatch) {
          yr = parseInt(yearMatch[1], 10);
        } else if (c.startDate) {
          yr = new Date(c.startDate).getFullYear();
        }

        const freq = (c.frequency || 'MONTHLY').toUpperCase();
        if (freq === 'MONTHLY') {
          const matchedMonth = MONTH_NAMES.find(m => c.name?.toLowerCase().includes(m.toLowerCase()));
          if (matchedMonth) {
            mth = matchedMonth;
            mthNum = MONTH_NAMES.indexOf(matchedMonth) + 1;
          } else if (c.startDate) {
            const d = new Date(c.startDate);
            mth = MONTH_NAMES[d.getMonth()];
            mthNum = d.getMonth() + 1;
          }
        } else if (freq === 'QUARTERLY') {
          const qMatch = c.name?.match(/Q([1-4])/i);
          mth = qMatch ? `Q${qMatch[1]}` : 'Q1';
        } else {
          mth = 'Annual';
        }

        if (yr) {
          await prisma.$executeRawUnsafe(`
            UPDATE "appraisal_cycles" 
            SET "year" = $1, "month" = $2, "monthNumber" = $3
            WHERE id = $4
          `, yr, mth, mthNum, c.id);
        }
      }
      console.log(`[dbInit] Successfully backfilled ${legacyCycles.length} appraisal cycles with Year/Month.`);
    }

    await ensurePasswordResetTable();
  } catch (err) {
    console.warn('[dbInit] Notice on appraisal cycle columns init:', err?.message || err);
  }
}

/**
 * Ensures password_reset_tokens table and indexes exist idempotently.
 */
export async function ensurePasswordResetTable() {
  try {
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "password_reset_tokens" (
        "id" TEXT PRIMARY KEY,
        "userId" TEXT NOT NULL REFERENCES "tenant_users"("id") ON DELETE CASCADE,
        "tokenHash" TEXT NOT NULL UNIQUE,
        "expiresAt" TIMESTAMP(3) NOT NULL,
        "usedAt" TIMESTAMP(3),
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
    `);

    try {
      await prisma.$executeRawUnsafe(`
        CREATE INDEX IF NOT EXISTS "password_reset_tokens_userId_idx" ON "password_reset_tokens"("userId");
      `);
      await prisma.$executeRawUnsafe(`
        CREATE INDEX IF NOT EXISTS "password_reset_tokens_tokenHash_idx" ON "password_reset_tokens"("tokenHash");
      `);
      await prisma.$executeRawUnsafe(`
        CREATE INDEX IF NOT EXISTS "password_reset_tokens_expiresAt_idx" ON "password_reset_tokens"("expiresAt");
      `);
    } catch {
      // Indexes already exist
    }
    console.log('[dbInit] password_reset_tokens table & indexes verified.');
  } catch (err) {
    console.warn('[dbInit] Notice on password_reset_tokens table init:', err?.message || err);
  }
}

