-- PLATFORM_OWNER: the operator of the platform itself, as distinct from
-- SUPER_ADMIN, which remains the highest role WITHIN a single company.
--
-- Purely additive. No existing enum value, column or row is altered, so every
-- current user and login flow is unaffected.
ALTER TYPE "UserRole" ADD VALUE IF NOT EXISTS 'PLATFORM_OWNER';

-- TenantUser.tenantId is NOT NULL, so a platform user still needs a tenant row.
-- It gets its own dedicated tenant, flagged here. Because every tenant-scoped
-- query already filters on tenantId, that alone keeps the platform owner out of
-- every company's data.
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "isPlatform" BOOLEAN NOT NULL DEFAULT false;
CREATE INDEX IF NOT EXISTS "tenants_isPlatform_idx" ON "tenants"("isPlatform");
