-- Audit trail for capability grants and revokes.
--
-- Registry capabilities open access to background-check PII (PAN numbers,
-- ex-employee conduct records). UserCapability.grantedById records the CURRENT
-- grant, but disappears on revoke — this table keeps the history.
-- Separate migration from the enum change: PostgreSQL cannot use a new enum
-- value in the same transaction that added it.

CREATE TABLE "capability_audit_logs" (
  "id"           TEXT NOT NULL,
  "tenantId"     TEXT NOT NULL,
  "action"       TEXT NOT NULL,
  "capability"   "Capability" NOT NULL,
  "targetUserId" TEXT NOT NULL,
  "actorId"      TEXT,
  "actorRole"    TEXT,
  "title"        TEXT,
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "capability_audit_logs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "capability_audit_logs_tenantId_createdAt_idx"     ON "capability_audit_logs" ("tenantId", "createdAt");
CREATE INDEX "capability_audit_logs_targetUserId_createdAt_idx" ON "capability_audit_logs" ("targetUserId", "createdAt");

ALTER TABLE "capability_audit_logs" ADD CONSTRAINT "capability_audit_logs_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "capability_audit_logs" ADD CONSTRAINT "capability_audit_logs_targetUserId_fkey"
  FOREIGN KEY ("targetUserId") REFERENCES "tenant_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "capability_audit_logs" ADD CONSTRAINT "capability_audit_logs_actorId_fkey"
  FOREIGN KEY ("actorId") REFERENCES "tenant_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
