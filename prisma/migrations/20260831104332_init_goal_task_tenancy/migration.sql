/*
  Warnings:

  - Added the required column `tenantId` to the `goals` table without a default value. This is not possible if the table is not empty.
  - Added the required column `tenantId` to the `tasks` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "ex_employee_records" ADD COLUMN     "docs" JSONB,
ADD COLUMN     "isDeleted" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "goals" ADD COLUMN     "attachments" TEXT[],
ADD COLUMN     "description" TEXT,
ADD COLUMN     "financialYear" TEXT,
ADD COLUMN     "goalType" TEXT DEFAULT 'General',
ADD COLUMN     "quarter" TEXT,
ADD COLUMN     "specialNotes" TEXT,
ADD COLUMN     "startDate" TIMESTAMP(3),
ADD COLUMN     "targetDate" TIMESTAMP(3),
ADD COLUMN     "tenantId" TEXT,
ALTER COLUMN "status" SET DEFAULT 'DRAFT';

-- AlterTable
ALTER TABLE "non_joiner_records" ADD COLUMN     "docs" JSONB,
ADD COLUMN     "isDeleted" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "tasks" ADD COLUMN     "dependency" JSONB,
ADD COLUMN     "financialYear" TEXT,
ADD COLUMN     "isDependencyOf" TEXT,
ADD COLUMN     "progress" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "startDate" TIMESTAMP(3),
ADD COLUMN     "tenantId" TEXT;

-- Backfill tenantId values from tenant_users table
UPDATE "goals" g
SET "tenantId" = u."tenantId"
FROM "tenant_users" u
WHERE g."employeeId" = u.id;

UPDATE "tasks" t
SET "tenantId" = u."tenantId"
FROM "tenant_users" u
WHERE t."employeeId" = u.id;

-- Fallback for orphaned records
UPDATE "goals" SET "tenantId" = (SELECT id FROM "tenants" LIMIT 1) WHERE "tenantId" IS NULL;
UPDATE "tasks" SET "tenantId" = (SELECT id FROM "tenants" LIMIT 1) WHERE "tenantId" IS NULL;

-- Alter columns to be NOT NULL
ALTER TABLE "goals" ALTER COLUMN "tenantId" SET NOT NULL;
ALTER TABLE "tasks" ALTER COLUMN "tenantId" SET NOT NULL;

-- AlterTable
ALTER TABLE "tenant_users" ADD COLUMN     "docs" JSONB,
ADD COLUMN     "isDeleted" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "remarks" TEXT;

-- CreateTable
CREATE TABLE "task_comments" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "comment" TEXT NOT NULL,
    "attachments" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "task_comments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "task_audit_logs" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "performedById" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "details" TEXT,
    "previousValue" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "task_audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "goal_comments" (
    "id" TEXT NOT NULL,
    "goalId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "comment" TEXT NOT NULL,
    "attachments" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "goal_comments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "goal_audit_logs" (
    "id" TEXT NOT NULL,
    "goalId" TEXT NOT NULL,
    "performedById" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "details" TEXT,
    "previousValue" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "goal_audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "recipientId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT,
    "entityType" TEXT,
    "entityId" TEXT,
    "isRead" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "task_comments_taskId_idx" ON "task_comments"("taskId");

-- CreateIndex
CREATE INDEX "task_audit_logs_taskId_idx" ON "task_audit_logs"("taskId");

-- CreateIndex
CREATE INDEX "goal_comments_goalId_idx" ON "goal_comments"("goalId");

-- CreateIndex
CREATE INDEX "goal_audit_logs_goalId_idx" ON "goal_audit_logs"("goalId");

-- CreateIndex
CREATE INDEX "notifications_recipientId_isRead_idx" ON "notifications"("recipientId", "isRead");

-- CreateIndex
CREATE INDEX "notifications_tenantId_idx" ON "notifications"("tenantId");

-- CreateIndex
CREATE INDEX "goals_tenantId_idx" ON "goals"("tenantId");

-- CreateIndex
CREATE INDEX "tasks_tenantId_idx" ON "tasks"("tenantId");

-- AddForeignKey
ALTER TABLE "goals" ADD CONSTRAINT "goals_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_comments" ADD CONSTRAINT "task_comments_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_comments" ADD CONSTRAINT "task_comments_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "tenant_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_audit_logs" ADD CONSTRAINT "task_audit_logs_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_audit_logs" ADD CONSTRAINT "task_audit_logs_performedById_fkey" FOREIGN KEY ("performedById") REFERENCES "tenant_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goal_comments" ADD CONSTRAINT "goal_comments_goalId_fkey" FOREIGN KEY ("goalId") REFERENCES "goals"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goal_comments" ADD CONSTRAINT "goal_comments_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "tenant_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goal_audit_logs" ADD CONSTRAINT "goal_audit_logs_goalId_fkey" FOREIGN KEY ("goalId") REFERENCES "goals"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goal_audit_logs" ADD CONSTRAINT "goal_audit_logs_performedById_fkey" FOREIGN KEY ("performedById") REFERENCES "tenant_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_recipientId_fkey" FOREIGN KEY ("recipientId") REFERENCES "tenant_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
