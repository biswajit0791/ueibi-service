-- A manager's adjustment to the credit EARNED for a task, typically reduced
-- when the work landed late.
--
-- Purely additive. `weight` is NOT touched: that column is the task's planned
-- share of its goal and must total exactly 100, and it drives the goal
-- execution lock and every completion percentage. This is a separate figure
-- about credit on delivery, and it changes no percentage anywhere.
--
-- NULL means "not adjusted" — the calculated earned credit stands. That makes
-- the migration a no-op for all 92 existing tasks.

ALTER TABLE "tasks" ADD COLUMN "managerFinalWeight" INTEGER;
ALTER TABLE "tasks" ADD COLUMN "weightAdjustedById" TEXT;
ALTER TABLE "tasks" ADD COLUMN "weightAdjustedAt" TIMESTAMP(3);
ALTER TABLE "tasks" ADD COLUMN "weightAdjustReason" TEXT;

ALTER TABLE "tasks" ADD CONSTRAINT "tasks_weightAdjustedById_fkey"
    FOREIGN KEY ("weightAdjustedById") REFERENCES "tenant_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
