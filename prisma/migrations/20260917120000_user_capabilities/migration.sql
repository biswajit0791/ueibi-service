-- Cross-cutting capabilities, additive on top of TenantUser.role.
--
-- Leadership is deliberately NOT a UserRole value: dashboardPermissions
-- .normalizeRole() maps the string 'LEADERSHIP' to SUPER_ADMIN, so adding it to
-- the role enum would silently grant every leader super-admin dashboard access.

CREATE TYPE "Capability" AS ENUM ('LEADERSHIP');

CREATE TABLE "user_capabilities" (
  "id"          TEXT NOT NULL,
  "tenantId"    TEXT NOT NULL,
  "userId"      TEXT NOT NULL,
  "capability"  "Capability" NOT NULL,
  "title"       TEXT,
  "grantedById" TEXT,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "user_capabilities_pkey" PRIMARY KEY ("id")
);

-- One grant of a given capability per user.
CREATE UNIQUE INDEX "user_capabilities_userId_capability_key"
  ON "user_capabilities" ("userId", "capability");
-- Primary read: "who are the leaders in this tenant".
CREATE INDEX "user_capabilities_tenantId_capability_idx"
  ON "user_capabilities" ("tenantId", "capability");

ALTER TABLE "user_capabilities" ADD CONSTRAINT "user_capabilities_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "user_capabilities" ADD CONSTRAINT "user_capabilities_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "tenant_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "user_capabilities" ADD CONSTRAINT "user_capabilities_grantedById_fkey"
  FOREIGN KEY ("grantedById") REFERENCES "tenant_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
