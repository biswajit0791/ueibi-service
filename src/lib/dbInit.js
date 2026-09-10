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
    await ensureGoalAssignmentsTable();
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

/**
 * Ensures goal_assignments table, foreign keys, unique constraints, and indexes exist idempotently.
 * Automatically backfills existing Goal.employeeId records into GoalAssignment.
 */
export async function ensureGoalAssignmentsTable() {
  try {
    // 1. Create goal_assignments table if not exists
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "goal_assignments" (
        "id" TEXT PRIMARY KEY,
        "tenantId" TEXT NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE,
        "goalId" TEXT NOT NULL REFERENCES "goals"("id") ON DELETE CASCADE ON UPDATE CASCADE,
        "employeeId" TEXT NOT NULL REFERENCES "tenant_users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
        "assignedById" TEXT REFERENCES "tenant_users"("id") ON DELETE SET NULL ON UPDATE CASCADE,
        "progress" INTEGER NOT NULL DEFAULT 0,
        "status" TEXT NOT NULL DEFAULT 'DRAFT',
        "milestones" INTEGER NOT NULL DEFAULT 0,
        "completedMilestones" INTEGER NOT NULL DEFAULT 0,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // 2. Make goals.employeeId nullable if needed
    try {
      await prisma.$executeRawUnsafe(`
        ALTER TABLE "goals" ALTER COLUMN "employeeId" DROP NOT NULL;
      `);
    } catch {
      // Column may already be nullable
    }

    // 3. Create unique constraint on (goalId, employeeId)
    try {
      await prisma.$executeRawUnsafe(`
        CREATE UNIQUE INDEX IF NOT EXISTS "goal_assignments_goalId_employeeId_key" 
        ON "goal_assignments"("goalId", "employeeId");
      `);
    } catch {
      // Unique index already exists
    }

    // 4. Create performance indexes
    try {
      await prisma.$executeRawUnsafe(`
        CREATE INDEX IF NOT EXISTS "goal_assignments_tenantId_idx" ON "goal_assignments"("tenantId");
      `);
      await prisma.$executeRawUnsafe(`
        CREATE INDEX IF NOT EXISTS "goal_assignments_goalId_idx" ON "goal_assignments"("goalId");
      `);
      await prisma.$executeRawUnsafe(`
        CREATE INDEX IF NOT EXISTS "goal_assignments_employeeId_idx" ON "goal_assignments"("employeeId");
      `);
      await prisma.$executeRawUnsafe(`
        CREATE INDEX IF NOT EXISTS "goal_assignments_assignedById_idx" ON "goal_assignments"("assignedById");
      `);
    } catch {
      // Indexes already exist
    }

    // 5. Backfill existing goal assignments from goals table
    const backfillCount = await prisma.$executeRawUnsafe(`
      INSERT INTO "goal_assignments" (
        "id", "tenantId", "goalId", "employeeId", "assignedById", "progress", "status", "milestones", "completedMilestones", "createdAt", "updatedAt"
      )
      SELECT 
        'ga_' || substr(md5(random()::text || g.id || g."employeeId"), 1, 20),
        g."tenantId",
        g.id,
        g."employeeId",
        NULL,
        COALESCE(g.progress, 0),
        COALESCE(g.status, 'DRAFT'),
        COALESCE(g.milestones, 0),
        COALESCE(g."completedMilestones", 0),
        g."createdAt",
        g."updatedAt"
      FROM "goals" g
      WHERE g."employeeId" IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM "goal_assignments" ga 
          WHERE ga."goalId" = g.id AND ga."employeeId" = g."employeeId"
        );
    `);

    console.log(`[dbInit] goal_assignments table verified. Backfilled ${backfillCount} legacy assignments.`);
  } catch (err) {
    console.warn('[dbInit] Notice on goal_assignments table init:', err?.message || err);
  }

  // 6. Reset any legacy auto-approved leave requests in the database
  try {
    const pendingLeaves = await prisma.leaveRequest.findMany({
      where: {
        status: 'PENDING',
        reason: { contains: 'Auto-approved' },
      },
    });

    for (const lr of pendingLeaves) {
      try {
        const parsed = JSON.parse(lr.reason);
        parsed.managerStatus = 'Pending';
        parsed.managerComment = null;
        parsed.managerActedAt = null;
        await prisma.leaveRequest.update({
          where: { id: lr.id },
          data: { reason: JSON.stringify(parsed) },
        });
        console.log(`[dbInit] Reset auto-approved status for pending leave ${lr.id}`);
      } catch {
        // ignore parse error
      }
    }
  } catch (leaveInitErr) {
    console.warn('[dbInit] Notice resetting auto-approved leaves:', leaveInitErr?.message || leaveInitErr);
  }

  // 7. Dynamic Leave & WFH System Initialization
  await ensureDynamicLeaveSystem();
}

/**
 * Ensures tables, columns, indexes, default leave types, WFH policies, and balances exist.
 */
export async function ensureDynamicLeaveSystem() {
  try {
    console.log('[dbInit] Verifying dynamic Leave & WFH tables and columns...');

    // A. Columns on leave_requests
    await prisma.$executeRawUnsafe(`
      DO $$ BEGIN
        ALTER TABLE "leave_requests" ADD COLUMN IF NOT EXISTS "tenantId" TEXT;
        ALTER TABLE "leave_requests" ADD COLUMN IF NOT EXISTS "leaveTypeId" TEXT;
        ALTER TABLE "leave_requests" ADD COLUMN IF NOT EXISTS "requestType" TEXT NOT NULL DEFAULT 'LEAVE';
        ALTER TABLE "leave_requests" ADD COLUMN IF NOT EXISTS "totalDays" DOUBLE PRECISION NOT NULL DEFAULT 1;
        ALTER TABLE "leave_requests" ADD COLUMN IF NOT EXISTS "dayType" TEXT NOT NULL DEFAULT 'FULL';
        ALTER TABLE "leave_requests" ADD COLUMN IF NOT EXISTS "attachmentUrl" TEXT;
        ALTER TABLE "leave_requests" ADD COLUMN IF NOT EXISTS "attachmentOriginalName" TEXT;
        ALTER TABLE "leave_requests" ADD COLUMN IF NOT EXISTS "managerStatus" TEXT NOT NULL DEFAULT 'Pending';
        ALTER TABLE "leave_requests" ADD COLUMN IF NOT EXISTS "managerId" TEXT;
        ALTER TABLE "leave_requests" ADD COLUMN IF NOT EXISTS "managerComment" TEXT;
        ALTER TABLE "leave_requests" ADD COLUMN IF NOT EXISTS "managerActedAt" TIMESTAMP(3);
        ALTER TABLE "leave_requests" ADD COLUMN IF NOT EXISTS "hrStatus" TEXT NOT NULL DEFAULT 'Pending';
        ALTER TABLE "leave_requests" ADD COLUMN IF NOT EXISTS "hrId" TEXT;
        ALTER TABLE "leave_requests" ADD COLUMN IF NOT EXISTS "hrComment" TEXT;
        ALTER TABLE "leave_requests" ADD COLUMN IF NOT EXISTS "hrActedAt" TIMESTAMP(3);
        ALTER TABLE "leave_requests" ADD COLUMN IF NOT EXISTS "rejectedById" TEXT;
        ALTER TABLE "leave_requests" ADD COLUMN IF NOT EXISTS "rejectedAt" TIMESTAMP(3);
        ALTER TABLE "leave_requests" ADD COLUMN IF NOT EXISTS "rejectionReason" TEXT;
        ALTER TABLE "leave_requests" ADD COLUMN IF NOT EXISTS "cancelledById" TEXT;
        ALTER TABLE "leave_requests" ADD COLUMN IF NOT EXISTS "cancelledAt" TIMESTAMP(3);
      END $$;
    `);

    // B. Create Tables
    const tables = [
      `CREATE TABLE IF NOT EXISTS "leave_types" (
        "id" TEXT NOT NULL,
        "tenantId" TEXT NOT NULL,
        "name" TEXT NOT NULL,
        "code" TEXT NOT NULL,
        "description" TEXT,
        "color" TEXT,
        "defaultDays" DOUBLE PRECISION NOT NULL DEFAULT 0,
        "allocationType" TEXT NOT NULL DEFAULT 'ANNUAL',
        "year" INTEGER,
        "isPaid" BOOLEAN NOT NULL DEFAULT true,
        "requiresApproval" BOOLEAN NOT NULL DEFAULT true,
        "allowHalfDay" BOOLEAN NOT NULL DEFAULT true,
        "allowNegativeBalance" BOOLEAN NOT NULL DEFAULT false,
        "maxConsecutiveDays" INTEGER,
        "minNoticeDays" INTEGER NOT NULL DEFAULT 0,
        "carryForwardAllowed" BOOLEAN NOT NULL DEFAULT false,
        "maxCarryForwardDays" INTEGER NOT NULL DEFAULT 0,
        "encashmentAllowed" BOOLEAN NOT NULL DEFAULT false,
        "requiresDocument" BOOLEAN NOT NULL DEFAULT false,
        "documentRequiredAfterDays" INTEGER NOT NULL DEFAULT 2,
        "isActive" BOOLEAN NOT NULL DEFAULT true,
        "createdById" TEXT,
        "updatedById" TEXT,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "leave_types_pkey" PRIMARY KEY ("id")
      )`,
      `CREATE TABLE IF NOT EXISTS "leave_balances" (
        "id" TEXT NOT NULL,
        "tenantId" TEXT NOT NULL,
        "employeeId" TEXT NOT NULL,
        "leaveTypeId" TEXT NOT NULL,
        "year" INTEGER NOT NULL,
        "allocated" DOUBLE PRECISION NOT NULL DEFAULT 0,
        "carriedForward" DOUBLE PRECISION NOT NULL DEFAULT 0,
        "adjusted" DOUBLE PRECISION NOT NULL DEFAULT 0,
        "used" DOUBLE PRECISION NOT NULL DEFAULT 0,
        "pending" DOUBLE PRECISION NOT NULL DEFAULT 0,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "leave_balances_pkey" PRIMARY KEY ("id")
      )`,
      `CREATE TABLE IF NOT EXISTS "wfh_policies" (
        "id" TEXT NOT NULL,
        "tenantId" TEXT NOT NULL,
        "isEnabled" BOOLEAN NOT NULL DEFAULT true,
        "annualDays" DOUBLE PRECISION NOT NULL DEFAULT 15,
        "requiresApproval" BOOLEAN NOT NULL DEFAULT true,
        "maxConsecutiveDays" INTEGER DEFAULT 5,
        "minNoticeDays" INTEGER NOT NULL DEFAULT 0,
        "monthlyLimit" INTEGER,
        "isActive" BOOLEAN NOT NULL DEFAULT true,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "wfh_policies_pkey" PRIMARY KEY ("id")
      )`,
      `CREATE TABLE IF NOT EXISTS "wfh_balances" (
        "id" TEXT NOT NULL,
        "tenantId" TEXT NOT NULL,
        "employeeId" TEXT NOT NULL,
        "year" INTEGER NOT NULL,
        "allocated" DOUBLE PRECISION NOT NULL DEFAULT 15,
        "adjusted" DOUBLE PRECISION NOT NULL DEFAULT 0,
        "used" DOUBLE PRECISION NOT NULL DEFAULT 0,
        "pending" DOUBLE PRECISION NOT NULL DEFAULT 0,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "wfh_balances_pkey" PRIMARY KEY ("id")
      )`,
      `CREATE TABLE IF NOT EXISTS "leave_audit_logs" (
        "id" TEXT NOT NULL,
        "tenantId" TEXT NOT NULL,
        "leaveTypeId" TEXT,
        "leaveRequestId" TEXT,
        "actorUserId" TEXT NOT NULL,
        "action" TEXT NOT NULL,
        "details" TEXT,
        "ipAddress" TEXT,
        "userAgent" TEXT,
        "metadata" JSONB,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "leave_audit_logs_pkey" PRIMARY KEY ("id")
      )`,
      `CREATE TABLE IF NOT EXISTS "leave_balance_adjustments" (
        "id" TEXT NOT NULL,
        "tenantId" TEXT NOT NULL,
        "employeeId" TEXT NOT NULL,
        "leaveTypeId" TEXT,
        "isWfh" BOOLEAN NOT NULL DEFAULT false,
        "year" INTEGER NOT NULL,
        "previousBalance" DOUBLE PRECISION NOT NULL,
        "newBalance" DOUBLE PRECISION NOT NULL,
        "adjustmentAmount" DOUBLE PRECISION NOT NULL,
        "reason" TEXT NOT NULL,
        "adjustedById" TEXT NOT NULL,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "leave_balance_adjustments_pkey" PRIMARY KEY ("id")
      )`
    ];

    for (const tableSql of tables) {
      await prisma.$executeRawUnsafe(tableSql);
    }

    // C. Indexes & Constraints
    const indexes = [
      `CREATE UNIQUE INDEX IF NOT EXISTS "leave_types_tenantId_code_key" ON "leave_types"("tenantId", "code")`,
      `CREATE INDEX IF NOT EXISTS "leave_types_tenantId_isActive_idx" ON "leave_types"("tenantId", "isActive")`,
      `CREATE UNIQUE INDEX IF NOT EXISTS "leave_balances_tenantId_employeeId_leaveTypeId_year_key" ON "leave_balances"("tenantId", "employeeId", "leaveTypeId", "year")`,
      `CREATE INDEX IF NOT EXISTS "leave_balances_tenantId_employeeId_year_idx" ON "leave_balances"("tenantId", "employeeId", "year")`,
      `CREATE UNIQUE INDEX IF NOT EXISTS "wfh_policies_tenantId_key" ON "wfh_policies"("tenantId")`,
      `CREATE UNIQUE INDEX IF NOT EXISTS "wfh_balances_tenantId_employeeId_year_key" ON "wfh_balances"("tenantId", "employeeId", "year")`,
      `CREATE INDEX IF NOT EXISTS "wfh_balances_tenantId_employeeId_year_idx" ON "wfh_balances"("tenantId", "employeeId", "year")`,
      `CREATE INDEX IF NOT EXISTS "leave_requests_tenantId_idx" ON "leave_requests"("tenantId")`,
      `CREATE INDEX IF NOT EXISTS "leave_requests_employeeId_status_idx" ON "leave_requests"("employeeId", "status")`,
      `CREATE INDEX IF NOT EXISTS "leave_requests_leaveTypeId_idx" ON "leave_requests"("leaveTypeId")`,
      `CREATE INDEX IF NOT EXISTS "leave_requests_startDate_endDate_idx" ON "leave_requests"("startDate", "endDate")`,
      `CREATE INDEX IF NOT EXISTS "leave_audit_logs_tenantId_idx" ON "leave_audit_logs"("tenantId")`,
      `CREATE INDEX IF NOT EXISTS "leave_audit_logs_action_idx" ON "leave_audit_logs"("action")`,
      `CREATE INDEX IF NOT EXISTS "leave_balance_adjustments_tenantId_idx" ON "leave_balance_adjustments"("tenantId")`,
      `CREATE INDEX IF NOT EXISTS "leave_balance_adjustments_employeeId_idx" ON "leave_balance_adjustments"("employeeId")`
    ];

    for (const idxSql of indexes) {
      await prisma.$executeRawUnsafe(idxSql);
    }

    // D. Foreign Keys
    await prisma.$executeRawUnsafe(`
      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'leave_requests_tenantId_fkey') THEN
          ALTER TABLE "leave_requests" ADD CONSTRAINT "leave_requests_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'leave_requests_leaveTypeId_fkey') THEN
          ALTER TABLE "leave_requests" ADD CONSTRAINT "leave_requests_leaveTypeId_fkey" FOREIGN KEY ("leaveTypeId") REFERENCES "leave_types"("id") ON DELETE SET NULL ON UPDATE CASCADE;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'leave_types_tenantId_fkey') THEN
          ALTER TABLE "leave_types" ADD CONSTRAINT "leave_types_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'leave_balances_tenantId_fkey') THEN
          ALTER TABLE "leave_balances" ADD CONSTRAINT "leave_balances_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'leave_balances_leaveTypeId_fkey') THEN
          ALTER TABLE "leave_balances" ADD CONSTRAINT "leave_balances_leaveTypeId_fkey" FOREIGN KEY ("leaveTypeId") REFERENCES "leave_types"("id") ON DELETE CASCADE ON UPDATE CASCADE;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'wfh_policies_tenantId_fkey') THEN
          ALTER TABLE "wfh_policies" ADD CONSTRAINT "wfh_policies_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'wfh_balances_tenantId_fkey') THEN
          ALTER TABLE "wfh_balances" ADD CONSTRAINT "wfh_balances_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
        END IF;
      END $$;
    `);

    // E. Backfill tenantId in leave_requests
    await prisma.$executeRawUnsafe(`
      UPDATE "leave_requests" lr
      SET "tenantId" = tu."tenantId"
      FROM "tenant_users" tu
      WHERE lr."employeeId" = tu.id AND lr."tenantId" IS NULL;
    `);

    // F. Seed default Leave Types & WFH Policies for each tenant
    const tenants = await prisma.tenant.findMany({ select: { id: true } });
    const currentYear = new Date().getFullYear();

    for (const t of tenants) {
      // 1. WFH Policy
      await prisma.$executeRawUnsafe(`
        INSERT INTO "wfh_policies" ("id", "tenantId", "isEnabled", "annualDays", "requiresApproval", "maxConsecutiveDays", "minNoticeDays", "isActive", "createdAt", "updatedAt")
        VALUES ('wfh_' || substr(md5(random()::text || '${t.id}'), 1, 20), '${t.id}', true, 15, true, 5, 0, true, NOW(), NOW())
        ON CONFLICT ("tenantId") DO NOTHING;
      `);

      // 2. Default Leave Types: Annual, Sick, Casual
      const defaultTypes = [
        {
          code: 'ANNUAL',
          name: 'Annual Leave',
          desc: 'Paid time off for rest, recreation, and personal pursuits.',
          days: 18,
          halfDay: true,
          carryForward: true,
          maxCarry: 5,
        },
        {
          code: 'SICK',
          name: 'Sick Leave',
          desc: 'Time off for medical recovery, illnesses, and healthcare visits.',
          days: 10,
          halfDay: true,
          docReq: true,
          docAfter: 2,
        },
        {
          code: 'CASUAL',
          name: 'Casual Leave',
          desc: 'Short leaves for urgent personal affairs and unforeseen contingencies.',
          days: 8,
          halfDay: true,
          maxConsecutive: 3,
        },
      ];

      for (const lt of defaultTypes) {
        await prisma.$executeRawUnsafe(`
          INSERT INTO "leave_types" (
            "id", "tenantId", "name", "code", "description", "defaultDays", "allocationType", "year",
            "isPaid", "requiresApproval", "allowHalfDay", "allowNegativeBalance", "maxConsecutiveDays",
            "minNoticeDays", "carryForwardAllowed", "maxCarryForwardDays", "encashmentAllowed",
            "requiresDocument", "documentRequiredAfterDays", "isActive", "createdAt", "updatedAt"
          ) VALUES (
            'lt_' || substr(md5(random()::text || '${t.id}' || '${lt.code}'), 1, 20),
            '${t.id}',
            '${lt.name}',
            '${lt.code}',
            '${lt.desc}',
            ${lt.days},
            'ANNUAL',
            ${currentYear},
            true,
            true,
            ${lt.halfDay ? 'true' : 'false'},
            false,
            ${lt.maxConsecutive || 'NULL'},
            0,
            ${lt.carryForward ? 'true' : 'false'},
            ${lt.maxCarry || 0},
            false,
            ${lt.docReq ? 'true' : 'false'},
            ${lt.docAfter || 2},
            true,
            NOW(),
            NOW()
          ) ON CONFLICT ("tenantId", "code") DO NOTHING;
        `);
      }

      // 3. Link legacy leave_requests to leaveTypeId and parse metadata
      const rawLeaves = await prisma.$queryRawUnsafe(`
        SELECT lr.id, lr."employeeId", lr.type, lr.reason, lr."startDate", lr."endDate", lr.status
        FROM "leave_requests" lr
        WHERE lr."tenantId" = '${t.id}' AND lr."leaveTypeId" IS NULL
      `);

      if (Array.isArray(rawLeaves) && rawLeaves.length > 0) {
        const tenantTypes = await prisma.$queryRawUnsafe(`
          SELECT id, code, name FROM "leave_types" WHERE "tenantId" = '${t.id}'
        `);

        for (const lr of rawLeaves) {
          let matchedTypeId = null;
          let reqType = 'LEAVE';
          const typeLower = (lr.type || '').toLowerCase();

          if (typeLower.includes('wfh') || typeLower.includes('work from home')) {
            reqType = 'WFH';
          } else if (typeLower.includes('sick')) {
            matchedTypeId = tenantTypes.find(x => x.code === 'SICK')?.id;
          } else if (typeLower.includes('casual')) {
            matchedTypeId = tenantTypes.find(x => x.code === 'CASUAL')?.id;
          } else {
            matchedTypeId = tenantTypes.find(x => x.code === 'ANNUAL')?.id;
          }

          let parsedDays = 1;
          let managerStatus = lr.status === 'APPROVED' ? 'Approved' : lr.status === 'REJECTED' ? 'Rejected' : 'Pending';
          let hrStatus = lr.status === 'APPROVED' ? 'Approved' : lr.status === 'REJECTED' ? 'Rejected' : 'Pending';
          let mgrComment = null;
          let hrComment = null;

          if (lr.reason && lr.reason.startsWith('{') && lr.reason.endsWith('}')) {
            try {
              const meta = JSON.parse(lr.reason);
              if (meta.totalDays) parsedDays = Number(meta.totalDays);
              if (meta.managerStatus) managerStatus = meta.managerStatus;
              if (meta.hrStatus) hrStatus = meta.hrStatus;
              if (meta.managerComment) mgrComment = meta.managerComment;
              if (meta.hrComment) hrComment = meta.hrComment;
              if (meta.requestType) reqType = meta.requestType;
            } catch {
              // ignore
            }
          }

          await prisma.$executeRawUnsafe(`
            UPDATE "leave_requests"
            SET "leaveTypeId" = ${matchedTypeId ? `'${matchedTypeId}'` : 'NULL'},
                "requestType" = '${reqType}',
                "totalDays" = ${parsedDays},
                "managerStatus" = '${managerStatus}',
                "hrStatus" = '${hrStatus}',
                "managerComment" = ${mgrComment ? `'${mgrComment.replace(/'/g, "''")}'` : 'NULL'},
                "hrComment" = ${hrComment ? `'${hrComment.replace(/'/g, "''")}'` : 'NULL'}
            WHERE id = '${lr.id}';
          `);
        }
      }

      // 4. Seed LeaveBalance and WfhBalance for active employees
      const employees = await prisma.$queryRawUnsafe(`
        SELECT id FROM "tenant_users" WHERE "tenantId" = '${t.id}' AND "isDeleted" = false
      `);

      const activeTypes = await prisma.$queryRawUnsafe(`
        SELECT id, "defaultDays" FROM "leave_types" WHERE "tenantId" = '${t.id}' AND "isActive" = true
      `);

      for (const emp of employees) {
        // Leave Balances
        for (const at of activeTypes) {
          await prisma.$executeRawUnsafe(`
            INSERT INTO "leave_balances" (
              "id", "tenantId", "employeeId", "leaveTypeId", "year", "allocated", "carriedForward", "adjusted", "used", "pending", "createdAt", "updatedAt"
            ) VALUES (
              'lb_' || substr(md5(random()::text || '${t.id}' || '${emp.id}' || '${at.id}' || '${currentYear}'), 1, 20),
              '${t.id}',
              '${emp.id}',
              '${at.id}',
              ${currentYear},
              ${at.defaultDays || 0},
              0,
              0,
              0,
              0,
              NOW(),
              NOW()
            ) ON CONFLICT ("tenantId", "employeeId", "leaveTypeId", "year") DO NOTHING;
          `);
        }

        // WFH Balances
        await prisma.$executeRawUnsafe(`
          INSERT INTO "wfh_balances" (
            "id", "tenantId", "employeeId", "year", "allocated", "adjusted", "used", "pending", "createdAt", "updatedAt"
          ) VALUES (
            'wb_' || substr(md5(random()::text || '${t.id}' || '${emp.id}' || '${currentYear}'), 1, 20),
            '${t.id}',
            '${emp.id}',
            ${currentYear},
            15,
            0,
            0,
            0,
            NOW(),
            NOW()
          ) ON CONFLICT ("tenantId", "employeeId", "year") DO NOTHING;
        `);
      }
    }

    console.log('[dbInit] Dynamic Leave & WFH system initialized and verified successfully.');
  } catch (err) {
    console.warn('[dbInit] Notice on dynamic leave system init:', err?.message || err);
  }
}


