-- Blood Group master list: tenant-scoped, RBAC-managed, feeds the onboarding
-- dropdown. Mirrors the departments table rather than a hard-coded enum so a
-- rare phenotype (Bombay/hh, Rh-null) can be added without a migration.

CREATE TABLE "blood_groups" (
  "id"        TEXT NOT NULL,
  "tenantId"  TEXT NOT NULL,
  "name"      TEXT NOT NULL,
  "isActive"  BOOLEAN NOT NULL DEFAULT true,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "createdBy" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "blood_groups_pkey" PRIMARY KEY ("id")
);

-- No duplicate names within a tenant.
CREATE UNIQUE INDEX "blood_groups_tenantId_name_key" ON "blood_groups" ("tenantId", "name");
-- Primary read: the active list for the dropdown.
CREATE INDEX "blood_groups_tenantId_isActive_idx" ON "blood_groups" ("tenantId", "isActive");

ALTER TABLE "blood_groups" ADD CONSTRAINT "blood_groups_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
