-- Exit clearance Phase 1: department heads + one row per exit clearance.
-- Purely additive. Existing exits get their clearance rows from application
-- code on first read (see ensureClearanceRows in exit.controller.js), built
-- from the legacy boolean columns, so nothing here touches existing data.

-- AlterTable
ALTER TABLE "departments" ADD COLUMN IF NOT EXISTS "headId" TEXT;
ALTER TABLE "departments" ADD COLUMN IF NOT EXISTS "alternateHeadId" TEXT;

-- CreateTable
CREATE TABLE IF NOT EXISTS "exit_clearances" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "exitId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "departmentName" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "remarks" TEXT,
    "fileUrl" TEXT,
    "fileName" TEXT,
    "actedById" TEXT,
    "actedByName" TEXT,
    "actedAt" TIMESTAMP(3),
    "onBehalf" BOOLEAN NOT NULL DEFAULT false,
    "onBehalfReason" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "exit_clearances_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "exit_clearance_events" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "clearanceId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "actorId" TEXT,
    "actorName" TEXT,
    "onBehalf" BOOLEAN NOT NULL DEFAULT false,
    "reason" TEXT,
    "remarks" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "exit_clearance_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "exit_clearances_tenantId_status_idx" ON "exit_clearances"("tenantId", "status");
CREATE UNIQUE INDEX IF NOT EXISTS "exit_clearances_exitId_key_key" ON "exit_clearances"("exitId", "key");
CREATE INDEX IF NOT EXISTS "exit_clearance_events_clearanceId_createdAt_idx" ON "exit_clearance_events"("clearanceId", "createdAt");

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "exit_clearances" ADD CONSTRAINT "exit_clearances_exitId_fkey"
    FOREIGN KEY ("exitId") REFERENCES "exit_details"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "exit_clearance_events" ADD CONSTRAINT "exit_clearance_events_clearanceId_fkey"
    FOREIGN KEY ("clearanceId") REFERENCES "exit_clearances"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
