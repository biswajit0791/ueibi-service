-- Goal task weighting: a goal's tasks must total exactly 100% before its
-- execution unlocks. Purely additive — no existing column is altered or dropped.

-- When work on a task actually began and actually finished, as opposed to the
-- planned startDate / dueDate. Delay is the gap between the two pairs.
ALTER TABLE "tasks" ADD COLUMN "actualStartDate" TIMESTAMP(3);
ALTER TABLE "tasks" ADD COLUMN "actualCompletionDate" TIMESTAMP(3);

-- Grandfathering. Applying the 100% rule retroactively would freeze every live
-- goal: not one of the 31 goals with tasks totals 100, two already exceed it,
-- and 28 have work in flight. A goal whose work has already begun is therefore
-- exempt and keeps behaving exactly as it did. New goals are not exempt.
ALTER TABLE "goals" ADD COLUMN "weightLockExempt" BOOLEAN NOT NULL DEFAULT false;

UPDATE "goals" g
SET "weightLockExempt" = true
WHERE EXISTS (
  SELECT 1 FROM "tasks" t
  WHERE t."goalId" = g."id"
    AND (t."status" <> 'todo' OR t."progress" > 0)
);

-- actualStartDate / actualCompletionDate are deliberately NOT backfilled.
-- The only available proxy is updatedAt, which is the last time a row changed
-- for any reason, not the moment work finished. Deriving delay figures from it
-- would put invented numbers in front of managers, so legacy tasks report
-- "not recorded" instead.
