-- AlterTable tenant_settings
ALTER TABLE "tenant_settings" ADD COLUMN IF NOT EXISTS "hierarchyVisibility" JSONB;
ALTER TABLE "tenant_settings" ADD COLUMN IF NOT EXISTS "rolePermissions" JSONB;
ALTER TABLE "tenant_settings" ADD COLUMN IF NOT EXISTS "dashboardConfig" JSONB;

-- CreateTable permission_audit_logs
CREATE TABLE IF NOT EXISTS "permission_audit_logs" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "actorRole" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "targetRole" TEXT,
    "details" TEXT,
    "changes" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "permission_audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "permission_audit_logs_tenantId_createdAt_idx" ON "permission_audit_logs"("tenantId", "createdAt");
CREATE INDEX IF NOT EXISTS "permission_audit_logs_actorId_idx" ON "permission_audit_logs"("actorId");

-- AddForeignKey
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'permission_audit_logs_tenantId_fkey'
    ) THEN
        ALTER TABLE "permission_audit_logs" ADD CONSTRAINT "permission_audit_logs_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'permission_audit_logs_actorId_fkey'
    ) THEN
        ALTER TABLE "permission_audit_logs" ADD CONSTRAINT "permission_audit_logs_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "tenant_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;
