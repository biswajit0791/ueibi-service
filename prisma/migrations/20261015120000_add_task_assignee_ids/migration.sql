-- AlterTable tasks: Add assigneeIds array column for multi-assignee task support
ALTER TABLE "tasks" ADD COLUMN IF NOT EXISTS "assigneeIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

-- Backfill assigneeIds with existing primary employeeId for existing tasks
UPDATE "tasks"
SET "assigneeIds" = ARRAY["employeeId"]
WHERE "employeeId" IS NOT NULL
  AND ("assigneeIds" IS NULL OR cardinality("assigneeIds") = 0);
