-- CreateTable
CREATE TABLE IF NOT EXISTS "organization_structures" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "displayOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "organization_structures_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "organization_structures_code_key" ON "organization_structures"("code");
CREATE INDEX IF NOT EXISTS "organization_structures_isActive_idx" ON "organization_structures"("isActive");
CREATE INDEX IF NOT EXISTS "organization_structures_displayOrder_idx" ON "organization_structures"("displayOrder");

-- AlterTable
ALTER TABLE "company_registrations" ADD COLUMN IF NOT EXISTS "organizationStructureId" TEXT;

-- CreateIndex
CREATE INDEX IF NOT EXISTS "company_registrations_organizationStructureId_idx" ON "company_registrations"("organizationStructureId");

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'company_registrations_organizationStructureId_fkey'
  ) THEN
    ALTER TABLE "company_registrations" ADD CONSTRAINT "company_registrations_organizationStructureId_fkey"
    FOREIGN KEY ("organizationStructureId") REFERENCES "organization_structures"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

