-- AlterTable
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "logoUrl" TEXT;

-- AlterTable
ALTER TABLE "company_registrations" ADD COLUMN IF NOT EXISTS "logoUrl" TEXT;

-- AlterTable
ALTER TABLE "tenant_settings" ADD COLUMN IF NOT EXISTS "logoUrl" TEXT;
