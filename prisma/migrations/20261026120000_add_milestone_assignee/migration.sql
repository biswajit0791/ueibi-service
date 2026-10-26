-- AlterTable: each milestone may be owned by one member (any team)
ALTER TABLE "task_milestones" ADD COLUMN IF NOT EXISTS "assigneeId" TEXT;

-- CreateIndex
CREATE INDEX IF NOT EXISTS "task_milestones_assigneeId_idx" ON "task_milestones"("assigneeId");

-- AddForeignKey
ALTER TABLE "task_milestones"
  ADD CONSTRAINT "task_milestones_assigneeId_fkey"
  FOREIGN KEY ("assigneeId") REFERENCES "tenant_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
