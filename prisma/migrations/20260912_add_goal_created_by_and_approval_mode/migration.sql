-- Migration: add_goal_created_by_and_approval_mode
-- Safe additive migration. All new columns are nullable/have defaults.
-- No existing data is modified. No tables dropped. No columns removed.

-- Add createdById: nullable FK to tenant_users (who created this goal).
-- Existing rows default to NULL, preserving backward compatibility.
ALTER TABLE "goals"
  ADD COLUMN IF NOT EXISTS "createdById" TEXT;

-- Add approvalMode: nullable string field.
-- Values: 'MANAGER_APPROVAL' | 'AUTO_APPROVE' | NULL
-- NULL = employee self-created goal (legacy behaviour, DRAFT flow preserved).
ALTER TABLE "goals"
  ADD COLUMN IF NOT EXISTS "approvalMode" TEXT;

-- Add FK constraint with ON DELETE SET NULL so that if the creator account
-- is deactivated, existing goals are not broken.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'goals_createdById_fkey'
      AND table_name = 'goals'
  ) THEN
    ALTER TABLE "goals"
      ADD CONSTRAINT "goals_createdById_fkey"
      FOREIGN KEY ("createdById")
      REFERENCES "tenant_users"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- Index for efficient lookups by creator (e.g. "goals I created for others")
CREATE INDEX IF NOT EXISTS "goals_createdById_idx" ON "goals"("createdById");
