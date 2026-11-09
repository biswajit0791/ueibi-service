-- CreateTable
CREATE TABLE IF NOT EXISTS "task_dependencies" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "sourceTaskId" TEXT NOT NULL,
    "companionTaskId" TEXT,
    "dependencyType" TEXT NOT NULL DEFAULT 'pre',
    "requesterId" TEXT NOT NULL,
    "targetManagerId" TEXT NOT NULL,
    "requesterDepartment" TEXT,
    "targetDepartment" TEXT,
    "isCrossDepartment" BOOLEAN NOT NULL DEFAULT false,
    "deptHeadId" TEXT,
    "deptHeadApprovalReqd" BOOLEAN NOT NULL DEFAULT false,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "dueDate" TIMESTAMP(3),
    "weight" INTEGER NOT NULL DEFAULT 10,
    "status" TEXT NOT NULL DEFAULT 'PENDING_APPROVAL',
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "approvalNotes" TEXT,
    "rejectedById" TEXT,
    "rejectedAt" TIMESTAMP(3),
    "rejectionReason" TEXT,
    "deptHeadApprovedById" TEXT,
    "deptHeadApprovedAt" TIMESTAMP(3),
    "verifiedById" TEXT,
    "verifiedAt" TIMESTAMP(3),
    "verificationNotes" TEXT,
    "reworkRequestedById" TEXT,
    "reworkRequestedAt" TIMESTAMP(3),
    "reworkReason" TEXT,
    "reworkCount" INTEGER NOT NULL DEFAULT 0,
    "deliverableNotes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "task_dependencies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "dependency_audit_logs" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "dependencyId" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "goalId" TEXT,
    "performedById" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "previousStatus" TEXT,
    "newStatus" TEXT,
    "details" TEXT,
    "meta" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "dependency_audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "task_dependencies_companionTaskId_key" ON "task_dependencies"("companionTaskId");
CREATE INDEX IF NOT EXISTS "task_dependencies_tenantId_idx" ON "task_dependencies"("tenantId");
CREATE INDEX IF NOT EXISTS "task_dependencies_sourceTaskId_idx" ON "task_dependencies"("sourceTaskId");
CREATE INDEX IF NOT EXISTS "task_dependencies_requesterId_idx" ON "task_dependencies"("requesterId");
CREATE INDEX IF NOT EXISTS "task_dependencies_targetManagerId_idx" ON "task_dependencies"("targetManagerId");
CREATE INDEX IF NOT EXISTS "task_dependencies_status_idx" ON "task_dependencies"("status");
CREATE INDEX IF NOT EXISTS "task_dependencies_tenantId_status_idx" ON "task_dependencies"("tenantId", "status");

CREATE INDEX IF NOT EXISTS "dependency_audit_logs_dependencyId_idx" ON "dependency_audit_logs"("dependencyId");
CREATE INDEX IF NOT EXISTS "dependency_audit_logs_taskId_idx" ON "dependency_audit_logs"("taskId");
CREATE INDEX IF NOT EXISTS "dependency_audit_logs_tenantId_createdAt_idx" ON "dependency_audit_logs"("tenantId", "createdAt");

CREATE INDEX IF NOT EXISTS "tasks_isDependencyOf_idx" ON "tasks"("isDependencyOf");

-- AddForeignKey
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'task_dependencies_tenantId_fkey') THEN
        ALTER TABLE "task_dependencies" ADD CONSTRAINT "task_dependencies_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'task_dependencies_sourceTaskId_fkey') THEN
        ALTER TABLE "task_dependencies" ADD CONSTRAINT "task_dependencies_sourceTaskId_fkey" FOREIGN KEY ("sourceTaskId") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'task_dependencies_companionTaskId_fkey') THEN
        ALTER TABLE "task_dependencies" ADD CONSTRAINT "task_dependencies_companionTaskId_fkey" FOREIGN KEY ("companionTaskId") REFERENCES "tasks"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'task_dependencies_requesterId_fkey') THEN
        ALTER TABLE "task_dependencies" ADD CONSTRAINT "task_dependencies_requesterId_fkey" FOREIGN KEY ("requesterId") REFERENCES "tenant_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'task_dependencies_targetManagerId_fkey') THEN
        ALTER TABLE "task_dependencies" ADD CONSTRAINT "task_dependencies_targetManagerId_fkey" FOREIGN KEY ("targetManagerId") REFERENCES "tenant_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'task_dependencies_approvedById_fkey') THEN
        ALTER TABLE "task_dependencies" ADD CONSTRAINT "task_dependencies_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "tenant_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'task_dependencies_rejectedById_fkey') THEN
        ALTER TABLE "task_dependencies" ADD CONSTRAINT "task_dependencies_rejectedById_fkey" FOREIGN KEY ("rejectedById") REFERENCES "tenant_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'task_dependencies_deptHeadApprovedById_fkey') THEN
        ALTER TABLE "task_dependencies" ADD CONSTRAINT "task_dependencies_deptHeadApprovedById_fkey" FOREIGN KEY ("deptHeadApprovedById") REFERENCES "tenant_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'task_dependencies_verifiedById_fkey') THEN
        ALTER TABLE "task_dependencies" ADD CONSTRAINT "task_dependencies_verifiedById_fkey" FOREIGN KEY ("verifiedById") REFERENCES "tenant_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'task_dependencies_reworkRequestedById_fkey') THEN
        ALTER TABLE "task_dependencies" ADD CONSTRAINT "task_dependencies_reworkRequestedById_fkey" FOREIGN KEY ("reworkRequestedById") REFERENCES "tenant_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'dependency_audit_logs_tenantId_fkey') THEN
        ALTER TABLE "dependency_audit_logs" ADD CONSTRAINT "dependency_audit_logs_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'dependency_audit_logs_dependencyId_fkey') THEN
        ALTER TABLE "dependency_audit_logs" ADD CONSTRAINT "dependency_audit_logs_dependencyId_fkey" FOREIGN KEY ("dependencyId") REFERENCES "task_dependencies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'dependency_audit_logs_performedById_fkey') THEN
        ALTER TABLE "dependency_audit_logs" ADD CONSTRAINT "dependency_audit_logs_performedById_fkey" FOREIGN KEY ("performedById") REFERENCES "tenant_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    END IF;
END $$;