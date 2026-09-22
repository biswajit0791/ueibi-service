-- 1:1 meetings between two colleagues.
--
-- The "Schedule 1:1" button on the team member profile was a stub that only
-- raised a browser alert; nothing was stored. This is the record behind it.
--
-- Deliberately NOT reusing HubEvent: that is a company-wide announcement
-- (isFeatured, postedBy, visible to the whole tenant), whereas a 1:1 is private
-- to two people and their HR reporting chain.
CREATE TYPE "OneOnOneStatus" AS ENUM ('SCHEDULED', 'COMPLETED', 'CANCELLED');

CREATE TABLE "one_on_one_meetings" (
    "id"              TEXT NOT NULL,
    "tenantId"        TEXT NOT NULL,
    "organiserId"     TEXT NOT NULL,
    "participantId"   TEXT NOT NULL,
    "scheduledAt"     TIMESTAMP(3) NOT NULL,
    "durationMins"    INTEGER NOT NULL DEFAULT 30,
    "agenda"          TEXT,
    "location"        TEXT,
    "status"          "OneOnOneStatus" NOT NULL DEFAULT 'SCHEDULED',
    "outcomeNotes"    TEXT,
    "cancelledReason" TEXT,
    "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"       TIMESTAMP(3) NOT NULL,

    CONSTRAINT "one_on_one_meetings_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "one_on_one_meetings_tenantId_idx"      ON "one_on_one_meetings"("tenantId");
CREATE INDEX "one_on_one_meetings_organiserId_idx"   ON "one_on_one_meetings"("organiserId");
CREATE INDEX "one_on_one_meetings_participantId_idx" ON "one_on_one_meetings"("participantId");
CREATE INDEX "one_on_one_meetings_scheduledAt_idx"   ON "one_on_one_meetings"("scheduledAt");

ALTER TABLE "one_on_one_meetings" ADD CONSTRAINT "one_on_one_meetings_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "one_on_one_meetings" ADD CONSTRAINT "one_on_one_meetings_organiserId_fkey"
    FOREIGN KEY ("organiserId") REFERENCES "tenant_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "one_on_one_meetings" ADD CONSTRAINT "one_on_one_meetings_participantId_fkey"
    FOREIGN KEY ("participantId") REFERENCES "tenant_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
