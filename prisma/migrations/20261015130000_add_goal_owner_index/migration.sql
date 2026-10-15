-- AlterTable: ensure goals.ownerManagerId column and index exist
ALTER TABLE "goals" ADD COLUMN IF NOT EXISTS "ownerManagerId" TEXT;

-- CreateIndex
CREATE INDEX IF NOT EXISTS "goals_ownerManagerId_idx" ON "goals"("ownerManagerId");
