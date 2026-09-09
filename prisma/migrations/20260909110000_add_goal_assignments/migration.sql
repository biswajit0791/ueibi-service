-- AlterTable
ALTER TABLE "goals" ALTER COLUMN "employeeId" DROP NOT NULL;

-- CreateTable
CREATE TABLE "goal_assignments" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "goalId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "assignedById" TEXT,
    "progress" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "milestones" INTEGER NOT NULL DEFAULT 0,
    "completedMilestones" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "goal_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "goal_assignments_goalId_employeeId_key" ON "goal_assignments"("goalId", "employeeId");

-- CreateIndex
CREATE INDEX "goal_assignments_tenantId_idx" ON "goal_assignments"("tenantId");

-- CreateIndex
CREATE INDEX "goal_assignments_goalId_idx" ON "goal_assignments"("goalId");

-- CreateIndex
CREATE INDEX "goal_assignments_employeeId_idx" ON "goal_assignments"("employeeId");

-- CreateIndex
CREATE INDEX "goal_assignments_assignedById_idx" ON "goal_assignments"("assignedById");

-- AddForeignKey
ALTER TABLE "goal_assignments" ADD CONSTRAINT "goal_assignments_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goal_assignments" ADD CONSTRAINT "goal_assignments_goalId_fkey" FOREIGN KEY ("goalId") REFERENCES "goals"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goal_assignments" ADD CONSTRAINT "goal_assignments_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "tenant_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goal_assignments" ADD CONSTRAINT "goal_assignments_assignedById_fkey" FOREIGN KEY ("assignedById") REFERENCES "tenant_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Backfill legacy goals into goal_assignments
INSERT INTO "goal_assignments" (
    "id", "tenantId", "goalId", "employeeId", "assignedById", "progress", "status", "milestones", "completedMilestones", "createdAt", "updatedAt"
)
SELECT 
    'ga_' || substr(md5(random()::text || g.id || g."employeeId"), 1, 20),
    g."tenantId",
    g.id,
    g."employeeId",
    NULL,
    COALESCE(g.progress, 0),
    COALESCE(g.status, 'DRAFT'),
    COALESCE(g.milestones, 0),
    COALESCE(g."completedMilestones", 0),
    g."createdAt",
    g."updatedAt"
FROM "goals" g
WHERE g."employeeId" IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM "goal_assignments" ga 
    WHERE ga."goalId" = g.id AND ga."employeeId" = g."employeeId"
  );
