-- Replaces the sub-task checklist with critical-task milestones.
--
-- sub_tasks is dropped outright rather than migrated: it holds no rows (see
-- 20260925150000_sub_task_details), and milestones are a different shape —
-- dated, watcher-driven, propose/approve — not a rename of the checklist.

DROP TABLE IF EXISTS "sub_tasks";

ALTER TABLE "tasks" ADD COLUMN "isMilestoneTracked" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "task_milestones" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "dueDate" TIMESTAMP(3) NOT NULL,
    "watcherEmails" TEXT[],
    "status" TEXT NOT NULL DEFAULT 'PENDING_APPROVAL',
    "proposedCompletionDate" TIMESTAMP(3),
    "proposedById" TEXT,
    "proposedAt" TIMESTAMP(3),
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "isDone" BOOLEAN NOT NULL DEFAULT false,
    "completedById" TEXT,
    "completedAt" TIMESTAMP(3),
    "createdById" TEXT,
    "lastEscalatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "task_milestones_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "task_milestones_tenantId_idx" ON "task_milestones"("tenantId");
CREATE INDEX "task_milestones_taskId_idx" ON "task_milestones"("taskId");
CREATE INDEX "task_milestones_dueDate_idx" ON "task_milestones"("dueDate");

ALTER TABLE "task_milestones" ADD CONSTRAINT "task_milestones_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "task_milestones" ADD CONSTRAINT "task_milestones_taskId_fkey"
    FOREIGN KEY ("taskId") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "task_milestones" ADD CONSTRAINT "task_milestones_proposedById_fkey"
    FOREIGN KEY ("proposedById") REFERENCES "tenant_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "task_milestones" ADD CONSTRAINT "task_milestones_approvedById_fkey"
    FOREIGN KEY ("approvedById") REFERENCES "tenant_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "task_milestones" ADD CONSTRAINT "task_milestones_completedById_fkey"
    FOREIGN KEY ("completedById") REFERENCES "tenant_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "task_milestones" ADD CONSTRAINT "task_milestones_createdById_fkey"
    FOREIGN KEY ("createdById") REFERENCES "tenant_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
