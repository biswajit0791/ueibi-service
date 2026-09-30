-- Tenant-wide dynamic settings (the "Company Settings" page): watcher email
-- domain allowlist and whether a milestone needs manager approval before it
-- can be marked complete. One row per tenant, created lazily on first read.

CREATE TABLE "tenant_settings" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "milestoneWatcherDomains" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "milestoneRequireApproval" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tenant_settings_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "tenant_settings_tenantId_key" ON "tenant_settings"("tenantId");

ALTER TABLE "tenant_settings" ADD CONSTRAINT "tenant_settings_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Covers the daily milestone-escalation sweep's WHERE (status != 'DONE' AND
-- dueDate < now()) without a full-table scan as task_milestones grows.
CREATE INDEX "task_milestones_status_dueDate_idx" ON "task_milestones"("status", "dueDate");
