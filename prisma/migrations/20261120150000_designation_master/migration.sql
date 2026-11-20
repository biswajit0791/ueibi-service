-- CreateTable
CREATE TABLE IF NOT EXISTS "designations" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "description" TEXT,
    "displayOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdBy" TEXT,
    "updatedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "designations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "designations_code_key" ON "designations"("code");
CREATE INDEX IF NOT EXISTS "designations_isActive_idx" ON "designations"("isActive");
CREATE INDEX IF NOT EXISTS "designations_displayOrder_idx" ON "designations"("displayOrder");
CREATE INDEX IF NOT EXISTS "designations_isDefault_idx" ON "designations"("isDefault");

-- AlterTable
ALTER TABLE "company_registrations" ADD COLUMN IF NOT EXISTS "designationId" TEXT;

-- CreateIndex
CREATE INDEX IF NOT EXISTS "company_registrations_designationId_idx" ON "company_registrations"("designationId");

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'company_registrations_designationId_fkey'
  ) THEN
    ALTER TABLE "company_registrations" ADD CONSTRAINT "company_registrations_designationId_fkey"
    FOREIGN KEY ("designationId") REFERENCES "designations"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
