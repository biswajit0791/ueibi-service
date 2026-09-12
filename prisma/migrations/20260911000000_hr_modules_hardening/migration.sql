-- HR modules hardening migration
-- Idempotent (safe to re-run). Postgres.

-- 1. work_histories.endDate becomes nullable ("current" job = NULL end date)
ALTER TABLE "work_histories" ALTER COLUMN "endDate" DROP NOT NULL;

-- 2. goals.createdById — authorization now keys on the creator's user id
--    rather than their (non-unique) display name.
ALTER TABLE "goals" ADD COLUMN IF NOT EXISTS "createdById" TEXT;
CREATE INDEX IF NOT EXISTS "goals_createdById_idx" ON "goals"("createdById");

-- Best-effort backfill: only fills rows where the creator name matches exactly
-- one active user in the same tenant (ambiguous names are left NULL and fall
-- back to the legacy name check in application code).
UPDATE "goals" g
SET "createdById" = sub.id
FROM (
  SELECT u."tenantId", u."name", MIN(u."id") AS id
  FROM "tenant_users" u
  GROUP BY u."tenantId", u."name"
  HAVING COUNT(*) = 1
) sub
WHERE g."createdById" IS NULL
  AND g."createdBy" IS NOT NULL
  AND sub."tenantId" = g."tenantId"
  AND sub."name" = g."createdBy";

-- 3. tasks.goalId: ON DELETE CASCADE -> ON DELETE SET NULL so deleting a goal
--    no longer wipes employees' task history.
DO $$
DECLARE
  fk_name text;
BEGIN
  SELECT con.conname INTO fk_name
  FROM pg_constraint con
  JOIN pg_class rel ON rel.oid = con.conrelid
  WHERE rel.relname = 'tasks'
    AND con.contype = 'f'
    AND pg_get_constraintdef(con.oid) LIKE '%"goalId"%REFERENCES "goals"%';

  IF fk_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE "tasks" DROP CONSTRAINT %I', fk_name);
  END IF;

  ALTER TABLE "tasks"
    ADD CONSTRAINT "tasks_goalId_fkey"
    FOREIGN KEY ("goalId") REFERENCES "goals"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- 4. appraisal_cycles unique (tenantId, frequency, name) to stop concurrent
--    "ensure active cycle" calls creating duplicates. Merge any existing
--    duplicates into the earliest row first.
DO $$
DECLARE
  dup RECORD;
  keep_id text;
BEGIN
  FOR dup IN
    SELECT "tenantId", "frequency", "name", array_agg("id" ORDER BY "createdAt") AS ids
    FROM "appraisal_cycles"
    GROUP BY "tenantId", "frequency", "name"
    HAVING COUNT(*) > 1
  LOOP
    keep_id := dup.ids[1];
    -- repoint children to the kept cycle
    UPDATE "performance_reviews" SET "cycleId" = keep_id
      WHERE "cycleId" = ANY(dup.ids[2:array_length(dup.ids,1)])
      AND NOT EXISTS (
        SELECT 1 FROM "performance_reviews" pr2
        WHERE pr2."cycleId" = keep_id
          AND pr2."employeeId" = "performance_reviews"."employeeId"
          AND pr2."reviewType" = "performance_reviews"."reviewType"
      );
    DELETE FROM "performance_reviews" WHERE "cycleId" = ANY(dup.ids[2:array_length(dup.ids,1)]);
    UPDATE "appraisal_parameters" SET "cycleId" = keep_id WHERE "cycleId" = ANY(dup.ids[2:array_length(dup.ids,1)]);
    UPDATE "peer_nominations" SET "cycleId" = keep_id WHERE "cycleId" = ANY(dup.ids[2:array_length(dup.ids,1)]);
    DELETE FROM "appraisal_cycles" WHERE "id" = ANY(dup.ids[2:array_length(dup.ids,1)]);
  END LOOP;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "appraisal_cycles_tenantId_frequency_name_key"
  ON "appraisal_cycles"("tenantId", "frequency", "name");
