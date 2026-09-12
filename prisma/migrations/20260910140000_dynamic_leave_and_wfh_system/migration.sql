-- Dynamic Leave & Work From Home System Migration

-- 1. Alter Table: leave_requests
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

-- 2. Create Table: leave_types
CREATE TABLE IF NOT EXISTS "leave_types" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "description" TEXT,
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
);

-- 3. Create Table: leave_balances
CREATE TABLE IF NOT EXISTS "leave_balances" (
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
);

-- 4. Create Table: wfh_policies
CREATE TABLE IF NOT EXISTS "wfh_policies" (
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
);

-- 5. Create Table: wfh_balances
CREATE TABLE IF NOT EXISTS "wfh_balances" (
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
);

-- 6. Create Table: leave_audit_logs
CREATE TABLE IF NOT EXISTS "leave_audit_logs" (
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
);

-- 7. Create Table: leave_balance_adjustments
CREATE TABLE IF NOT EXISTS "leave_balance_adjustments" (
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
);

-- 8. Unique Constraints & Indexes
CREATE UNIQUE INDEX IF NOT EXISTS "leave_types_tenantId_code_key" ON "leave_types"("tenantId", "code");
CREATE INDEX IF NOT EXISTS "leave_types_tenantId_isActive_idx" ON "leave_types"("tenantId", "isActive");

CREATE UNIQUE INDEX IF NOT EXISTS "leave_balances_tenantId_employeeId_leaveTypeId_year_key" ON "leave_balances"("tenantId", "employeeId", "leaveTypeId", "year");
CREATE INDEX IF NOT EXISTS "leave_balances_tenantId_employeeId_year_idx" ON "leave_balances"("tenantId", "employeeId", "year");

CREATE UNIQUE INDEX IF NOT EXISTS "wfh_policies_tenantId_key" ON "wfh_policies"("tenantId");

CREATE UNIQUE INDEX IF NOT EXISTS "wfh_balances_tenantId_employeeId_year_key" ON "wfh_balances"("tenantId", "employeeId", "year");
CREATE INDEX IF NOT EXISTS "wfh_balances_tenantId_employeeId_year_idx" ON "wfh_balances"("tenantId", "employeeId", "year");

CREATE INDEX IF NOT EXISTS "leave_requests_tenantId_idx" ON "leave_requests"("tenantId");
CREATE INDEX IF NOT EXISTS "leave_requests_employeeId_status_idx" ON "leave_requests"("employeeId", "status");
CREATE INDEX IF NOT EXISTS "leave_requests_leaveTypeId_idx" ON "leave_requests"("leaveTypeId");
CREATE INDEX IF NOT EXISTS "leave_requests_startDate_endDate_idx" ON "leave_requests"("startDate", "endDate");

CREATE INDEX IF NOT EXISTS "leave_audit_logs_tenantId_idx" ON "leave_audit_logs"("tenantId");
CREATE INDEX IF NOT EXISTS "leave_audit_logs_action_idx" ON "leave_audit_logs"("action");

CREATE INDEX IF NOT EXISTS "leave_balance_adjustments_tenantId_idx" ON "leave_balance_adjustments"("tenantId");
CREATE INDEX IF NOT EXISTS "leave_balance_adjustments_employeeId_idx" ON "leave_balance_adjustments"("employeeId");

-- 9. Foreign Keys
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
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'leave_types_createdById_fkey') THEN
        ALTER TABLE "leave_types" ADD CONSTRAINT "leave_types_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "tenant_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'leave_types_updatedById_fkey') THEN
        ALTER TABLE "leave_types" ADD CONSTRAINT "leave_types_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "tenant_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'leave_balances_tenantId_fkey') THEN
        ALTER TABLE "leave_balances" ADD CONSTRAINT "leave_balances_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'leave_balances_employeeId_fkey') THEN
        ALTER TABLE "leave_balances" ADD CONSTRAINT "leave_balances_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "tenant_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
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
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'wfh_balances_employeeId_fkey') THEN
        ALTER TABLE "wfh_balances" ADD CONSTRAINT "wfh_balances_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "tenant_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'leave_audit_logs_tenantId_fkey') THEN
        ALTER TABLE "leave_audit_logs" ADD CONSTRAINT "leave_audit_logs_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'leave_audit_logs_leaveTypeId_fkey') THEN
        ALTER TABLE "leave_audit_logs" ADD CONSTRAINT "leave_audit_logs_leaveTypeId_fkey" FOREIGN KEY ("leaveTypeId") REFERENCES "leave_types"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'leave_audit_logs_leaveRequestId_fkey') THEN
        ALTER TABLE "leave_audit_logs" ADD CONSTRAINT "leave_audit_logs_leaveRequestId_fkey" FOREIGN KEY ("leaveRequestId") REFERENCES "leave_requests"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'leave_audit_logs_actorUserId_fkey') THEN
        ALTER TABLE "leave_audit_logs" ADD CONSTRAINT "leave_audit_logs_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "tenant_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'leave_balance_adjustments_tenantId_fkey') THEN
        ALTER TABLE "leave_balance_adjustments" ADD CONSTRAINT "leave_balance_adjustments_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'leave_balance_adjustments_employeeId_fkey') THEN
        ALTER TABLE "leave_balance_adjustments" ADD CONSTRAINT "leave_balance_adjustments_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "tenant_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'leave_balance_adjustments_leaveTypeId_fkey') THEN
        ALTER TABLE "leave_balance_adjustments" ADD CONSTRAINT "leave_balance_adjustments_leaveTypeId_fkey" FOREIGN KEY ("leaveTypeId") REFERENCES "leave_types"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'leave_balance_adjustments_adjustedById_fkey') THEN
        ALTER TABLE "leave_balance_adjustments" ADD CONSTRAINT "leave_balance_adjustments_adjustedById_fkey" FOREIGN KEY ("adjustedById") REFERENCES "tenant_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

-- 10. Backfill tenantId in leave_requests from employee
UPDATE "leave_requests" lr
SET "tenantId" = tu."tenantId"
FROM "tenant_users" tu
WHERE lr."employeeId" = tu.id AND lr."tenantId" IS NULL;
