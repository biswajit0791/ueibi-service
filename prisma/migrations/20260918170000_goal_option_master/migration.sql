-- Goal Category / Type / Priority master lists.
--
-- Goal.category, Goal.goalType and Goal.priority are plain strings with no FK,
-- so this table is purely a source for the dropdowns: archiving an option hides
-- it from the picker while existing goals keep their value, and renaming
-- cascades to those goals in the service layer.
--
-- Purely additive: no existing column or row is touched. The lists seed from
-- the previous hardcoded constants on first read, so nothing changes visually
-- until an admin edits them.

CREATE TYPE "GoalOptionKind" AS ENUM ('CATEGORY', 'TYPE', 'PRIORITY');

CREATE TABLE "goal_options" (
  "id"        TEXT NOT NULL,
  "tenantId"  TEXT NOT NULL,
  "kind"      "GoalOptionKind" NOT NULL,
  "label"     TEXT NOT NULL,
  "value"     TEXT NOT NULL,
  "isActive"  BOOLEAN NOT NULL DEFAULT true,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "color"     TEXT,
  "createdBy" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "goal_options_pkey" PRIMARY KEY ("id")
);

-- One stored value per kind per tenant.
CREATE UNIQUE INDEX "goal_options_tenantId_kind_value_key" ON "goal_options" ("tenantId", "kind", "value");
-- Primary read: the active list for one dropdown.
CREATE INDEX "goal_options_tenantId_kind_isActive_idx" ON "goal_options" ("tenantId", "kind", "isActive");

ALTER TABLE "goal_options" ADD CONSTRAINT "goal_options_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
