-- Sub-tasks become a full record rather than a checkbox: description, planned
-- dates and actual dates. Weight is deliberately still absent — a sub-task
-- never feeds the parent task's percentage or the goal's 100% total.
--
-- `completedAt` is replaced by `actualCompletionDate`, which means the same
-- thing under the name the rest of the schema already uses. Safe to drop
-- rather than migrate: the table was created earlier today and holds no rows.

ALTER TABLE "sub_tasks" ADD COLUMN "description" TEXT;
ALTER TABLE "sub_tasks" ADD COLUMN "startDate" TIMESTAMP(3);
ALTER TABLE "sub_tasks" ADD COLUMN "dueDate" TIMESTAMP(3);
ALTER TABLE "sub_tasks" ADD COLUMN "actualStartDate" TIMESTAMP(3);
ALTER TABLE "sub_tasks" ADD COLUMN "actualCompletionDate" TIMESTAMP(3);

UPDATE "sub_tasks" SET "actualCompletionDate" = "completedAt" WHERE "completedAt" IS NOT NULL;
ALTER TABLE "sub_tasks" DROP COLUMN "completedAt";
