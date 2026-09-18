-- One dispute can concern several employees ("the same issue affects both").
-- Purely additive: disputes.subjectEmployeeId is untouched and still holds the
-- primary subject, so every existing query, filter and notification keeps
-- working exactly as before.
CREATE TABLE "dispute_subjects" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "disputeId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "dispute_subjects_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "dispute_subjects_disputeId_employeeId_key" ON "dispute_subjects"("disputeId", "employeeId");
CREATE INDEX "dispute_subjects_tenantId_idx" ON "dispute_subjects"("tenantId");
CREATE INDEX "dispute_subjects_disputeId_idx" ON "dispute_subjects"("disputeId");
CREATE INDEX "dispute_subjects_employeeId_idx" ON "dispute_subjects"("employeeId");

ALTER TABLE "dispute_subjects" ADD CONSTRAINT "dispute_subjects_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "dispute_subjects" ADD CONSTRAINT "dispute_subjects_disputeId_fkey"
    FOREIGN KEY ("disputeId") REFERENCES "disputes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "dispute_subjects" ADD CONSTRAINT "dispute_subjects_employeeId_fkey"
    FOREIGN KEY ("employeeId") REFERENCES "tenant_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill: every existing ticket's current subject becomes its first subject
-- row, so reads can rely on this table alone rather than merging two sources.
INSERT INTO "dispute_subjects" ("id", "tenantId", "disputeId", "employeeId", "createdAt")
SELECT
    'dsb_' || md5(d."id" || ':' || d."subjectEmployeeId"),
    d."tenantId",
    d."id",
    d."subjectEmployeeId",
    d."createdAt"
FROM "disputes" d
WHERE d."subjectEmployeeId" IS NOT NULL
ON CONFLICT DO NOTHING;
