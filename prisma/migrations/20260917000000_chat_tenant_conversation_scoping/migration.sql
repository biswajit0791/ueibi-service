-- Chat: tenant + conversation scoping, delivery receipts, and the `messages`
-- table itself.
--
-- The Message model existed in schema.prisma but was never migrated, so the
-- table may or may not be present depending on the environment:
--   * fresh database  -> CREATE TABLE below builds the final shape directly.
--   * database where `messages` was created out-of-band (db push) -> the
--     ALTER/backfill block upgrades it in place.
-- Before this change a message had no tenantId/receiverId/conversationId, so
-- every row belonged to one implicit global room shared across all tenants.
-- Legacy rows are NOT deleted: any row whose sender cannot be resolved to a
-- tenant is quarantined under the '__legacy__' tenant so it can never surface
-- in a tenant-scoped query, but remains available for inspection.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'MessageStatus') THEN
    CREATE TYPE "MessageStatus" AS ENUM ('SENT', 'DELIVERED', 'READ');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "messages" (
  "id"             TEXT NOT NULL,
  "tenantId"       TEXT,
  "conversationId" TEXT,
  "senderId"       TEXT NOT NULL,
  "receiverId"     TEXT,
  "text"           TEXT NOT NULL,
  "mediaUrl"       TEXT,
  "mediaType"      TEXT,
  "fileName"       TEXT,
  "fileSize"       INTEGER,
  "isDeleted"      BOOLEAN NOT NULL DEFAULT false,
  "deletedFor"     TEXT[] DEFAULT ARRAY[]::TEXT[],
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "messages_pkey" PRIMARY KEY ("id")
);

-- Columns added by this migration (no-ops on a table this migration just created
-- with them, applied in place on a table that predates it).
ALTER TABLE "messages" ADD COLUMN IF NOT EXISTS "tenantId" TEXT;
ALTER TABLE "messages" ADD COLUMN IF NOT EXISTS "conversationId" TEXT;
ALTER TABLE "messages" ADD COLUMN IF NOT EXISTS "receiverId" TEXT;
ALTER TABLE "messages" ADD COLUMN IF NOT EXISTS "status" "MessageStatus" NOT NULL DEFAULT 'SENT';
ALTER TABLE "messages" ADD COLUMN IF NOT EXISTS "deliveredAt" TIMESTAMP(3);
ALTER TABLE "messages" ADD COLUMN IF NOT EXISTS "readAt" TIMESTAMP(3);

-- Backfill tenantId from the sender's tenant where the sender is a real user.
UPDATE "messages" m
SET "tenantId" = u."tenantId"
FROM "tenant_users" u
WHERE m."senderId" = u."id" AND m."tenantId" IS NULL;

-- Quarantine anything still unattributable (rows whose senderId was a socket id).
UPDATE "messages"
SET "tenantId" = '__legacy__'
WHERE "tenantId" IS NULL;

-- Legacy rows have no peer, so they get a per-tenant legacy conversation bucket.
UPDATE "messages"
SET "conversationId" = '__legacy__:' || "tenantId"
WHERE "conversationId" IS NULL;

ALTER TABLE "messages" ALTER COLUMN "tenantId" SET NOT NULL;
ALTER TABLE "messages" ALTER COLUMN "conversationId" SET NOT NULL;

CREATE INDEX IF NOT EXISTS "messages_senderId_idx" ON "messages" ("senderId");
CREATE INDEX IF NOT EXISTS "messages_createdAt_idx" ON "messages" ("createdAt");
CREATE INDEX IF NOT EXISTS "messages_tenantId_conversationId_createdAt_idx"
  ON "messages" ("tenantId", "conversationId", "createdAt");
CREATE INDEX IF NOT EXISTS "messages_tenantId_receiverId_status_idx"
  ON "messages" ("tenantId", "receiverId", "status");
