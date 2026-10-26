-- AlterTable: per-task completion review (submit -> approve / reject)
ALTER TABLE "tasks" ADD COLUMN IF NOT EXISTS "reviewStatus" TEXT;
ALTER TABLE "tasks" ADD COLUMN IF NOT EXISTS "reviewSubmittedAt" TIMESTAMP(3);
ALTER TABLE "tasks" ADD COLUMN IF NOT EXISTS "reviewedById" TEXT;
ALTER TABLE "tasks" ADD COLUMN IF NOT EXISTS "reviewedAt" TIMESTAMP(3);
ALTER TABLE "tasks" ADD COLUMN IF NOT EXISTS "reviewComment" TEXT;

-- AddForeignKey
ALTER TABLE "tasks"
  ADD CONSTRAINT "tasks_reviewedById_fkey"
  FOREIGN KEY ("reviewedById") REFERENCES "tenant_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
