-- AlterTable
ALTER TABLE "exit_details" ADD COLUMN IF NOT EXISTS "accessBlockedAt" TIMESTAMP(3);
ALTER TABLE "exit_details" ADD COLUMN IF NOT EXISTS "accessBlockedBy" TEXT;
