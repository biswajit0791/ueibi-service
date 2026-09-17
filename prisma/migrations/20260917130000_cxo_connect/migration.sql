-- CXO Connect: employee → leadership channel.
-- Ticket + reply thread, mirroring the Dispute module's shape.

CREATE TYPE "CxoCategory" AS ENUM ('APPRECIATION', 'SUGGESTION', 'CONCERN', 'QUESTION');
CREATE TYPE "CxoStatus"   AS ENUM ('PENDING', 'ACKNOWLEDGED', 'REPLIED', 'CLOSED');

CREATE TABLE "cxo_messages" (
  "id"                 TEXT NOT NULL,
  "tenantId"           TEXT NOT NULL,
  "ticketNumber"       TEXT NOT NULL,
  "subject"            TEXT NOT NULL,
  "body"               TEXT NOT NULL,
  "category"           "CxoCategory" NOT NULL DEFAULT 'SUGGESTION',
  "status"             "CxoStatus"   NOT NULL DEFAULT 'PENDING',
  "isAnonymous"        BOOLEAN NOT NULL DEFAULT false,
  "raisedById"         TEXT NOT NULL,
  "targetLeaderId"     TEXT,
  "assignedToId"       TEXT,
  "dueAt"              TIMESTAMP(3),
  "closedAt"           TIMESTAMP(3),
  "lastReplyAt"        TIMESTAMP(3),
  "readByEmployeeAt"   TIMESTAMP(3),
  "readByLeadershipAt" TIMESTAMP(3),
  "createdAt"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"          TIMESTAMP(3) NOT NULL,
  CONSTRAINT "cxo_messages_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "cxo_message_replies" (
  "id"                   TEXT NOT NULL,
  "tenantId"             TEXT NOT NULL,
  "messageId"            TEXT NOT NULL,
  "authorId"             TEXT NOT NULL,
  "body"                 TEXT NOT NULL,
  "isLeadershipResponse" BOOLEAN NOT NULL DEFAULT false,
  "createdAt"            TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "cxo_message_replies_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "cxo_messages_ticketNumber_key" ON "cxo_messages" ("ticketNumber");
CREATE INDEX "cxo_messages_tenantId_status_createdAt_idx"       ON "cxo_messages" ("tenantId", "status", "createdAt");
CREATE INDEX "cxo_messages_tenantId_targetLeaderId_status_idx"  ON "cxo_messages" ("tenantId", "targetLeaderId", "status");
CREATE INDEX "cxo_messages_tenantId_raisedById_createdAt_idx"   ON "cxo_messages" ("tenantId", "raisedById", "createdAt");
CREATE INDEX "cxo_message_replies_messageId_createdAt_idx"      ON "cxo_message_replies" ("messageId", "createdAt");

ALTER TABLE "cxo_messages" ADD CONSTRAINT "cxo_messages_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "cxo_messages" ADD CONSTRAINT "cxo_messages_raisedById_fkey"
  FOREIGN KEY ("raisedById") REFERENCES "tenant_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "cxo_messages" ADD CONSTRAINT "cxo_messages_targetLeaderId_fkey"
  FOREIGN KEY ("targetLeaderId") REFERENCES "tenant_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "cxo_messages" ADD CONSTRAINT "cxo_messages_assignedToId_fkey"
  FOREIGN KEY ("assignedToId") REFERENCES "tenant_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "cxo_message_replies" ADD CONSTRAINT "cxo_message_replies_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "cxo_message_replies" ADD CONSTRAINT "cxo_message_replies_messageId_fkey"
  FOREIGN KEY ("messageId") REFERENCES "cxo_messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "cxo_message_replies" ADD CONSTRAINT "cxo_message_replies_authorId_fkey"
  FOREIGN KEY ("authorId") REFERENCES "tenant_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
