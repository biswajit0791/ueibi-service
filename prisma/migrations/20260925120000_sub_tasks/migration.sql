-- Checklist items under a task.
--
-- Purely additive: a new table and nothing else. No existing column is touched,
-- and sub_tasks carries no weight or progress column of its own, so it cannot
-- feed into the goal weight total or the execution lock that depends on it.

CREATE TABLE "sub_tasks" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "isDone" BOOLEAN NOT NULL DEFAULT false,
    "assigneeId" TEXT,
    "completedAt" TIMESTAMP(3),
    "completedById" TEXT,
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sub_tasks_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "sub_tasks_tenantId_idx" ON "sub_tasks"("tenantId");
CREATE INDEX "sub_tasks_taskId_idx" ON "sub_tasks"("taskId");
CREATE INDEX "sub_tasks_assigneeId_idx" ON "sub_tasks"("assigneeId");

ALTER TABLE "sub_tasks" ADD CONSTRAINT "sub_tasks_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "sub_tasks" ADD CONSTRAINT "sub_tasks_taskId_fkey"
    FOREIGN KEY ("taskId") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "sub_tasks" ADD CONSTRAINT "sub_tasks_assigneeId_fkey"
    FOREIGN KEY ("assigneeId") REFERENCES "tenant_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "sub_tasks" ADD CONSTRAINT "sub_tasks_completedById_fkey"
    FOREIGN KEY ("completedById") REFERENCES "tenant_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "sub_tasks" ADD CONSTRAINT "sub_tasks_createdById_fkey"
    FOREIGN KEY ("createdById") REFERENCES "tenant_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
