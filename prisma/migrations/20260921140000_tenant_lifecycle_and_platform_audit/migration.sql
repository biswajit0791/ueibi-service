-- Phase 1 of the platform control plane: give a tenant a lifecycle, and give
-- the platform operator an audit trail.
--
-- Additive only. Every existing tenant becomes ACTIVE, which is exactly how
-- they behave today, so nothing changes for any current customer.

CREATE TYPE "TenantStatus" AS ENUM ('ACTIVE', 'TRIAL', 'SUSPENDED', 'EXPIRED');

ALTER TABLE "tenants"
  ADD COLUMN IF NOT EXISTS "status"           "TenantStatus" NOT NULL DEFAULT 'ACTIVE',
  ADD COLUMN IF NOT EXISTS "planEndsAt"       TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "suspendedAt"      TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "suspendedReason"  TEXT;

CREATE INDEX IF NOT EXISTS "tenants_status_idx" ON "tenants"("status");

-- Operator actions. The five existing audit models (task, goal, leave, policy,
-- capability) are all tenant-scoped and record what happens INSIDE a company;
-- none of them record what the platform owner does TO a company.
CREATE TABLE "platform_audit_logs" (
    "id"          TEXT NOT NULL,
    "actorId"     TEXT NOT NULL,
    "action"      TEXT NOT NULL,
    "targetType"  TEXT NOT NULL,
    "targetId"    TEXT,
    "tenantId"    TEXT,
    "beforeValue" JSONB,
    "afterValue"  JSONB,
    "reason"      TEXT,
    "ipAddress"   TEXT,
    "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "platform_audit_logs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "platform_audit_logs_actorId_idx"   ON "platform_audit_logs"("actorId");
CREATE INDEX "platform_audit_logs_tenantId_idx"  ON "platform_audit_logs"("tenantId");
CREATE INDEX "platform_audit_logs_action_idx"    ON "platform_audit_logs"("action");
CREATE INDEX "platform_audit_logs_createdAt_idx" ON "platform_audit_logs"("createdAt");

-- The actor is deliberately NOT a foreign key with cascade: an audit row must
-- survive the deletion of the operator who created it, or the trail can be
-- erased by removing an account.
