-- AlterTable
ALTER TABLE "policies" ADD COLUMN IF NOT EXISTS "expiryDate" TIMESTAMP(3);

-- CreateTable
CREATE TABLE IF NOT EXISTS "policy_versions" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "policyId" TEXT NOT NULL,
    "versionNumber" INTEGER NOT NULL DEFAULT 1,
    "versionString" TEXT NOT NULL DEFAULT '1.0',
    "title" TEXT NOT NULL,
    "description" TEXT,
    "changeNotes" TEXT,
    "content" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT 'Compliance',
    "status" "PolicyStatus" NOT NULL DEFAULT 'PUBLISHED',
    "isCurrent" BOOLEAN NOT NULL DEFAULT false,
    "pdfUrl" TEXT,
    "pdfOriginalName" TEXT,
    "contentHash" TEXT,
    "effectiveDate" TIMESTAMP(3),
    "expiryDate" TIMESTAMP(3),
    "dueDate" TIMESTAMP(3),
    "uploadedById" TEXT NOT NULL,
    "publishedById" TEXT,
    "publishedAt" TIMESTAMP(3),
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "policy_versions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "policy_versions_tenantId_idx" ON "policy_versions"("tenantId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "policy_versions_policyId_idx" ON "policy_versions"("policyId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "policy_versions_policyId_status_idx" ON "policy_versions"("policyId", "status");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "policy_versions_policyId_versionNumber_key" ON "policy_versions"("policyId", "versionNumber");

-- AddForeignKey
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'policy_versions_tenantId_fkey'
    ) THEN
        ALTER TABLE "policy_versions" ADD CONSTRAINT "policy_versions_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

-- AddForeignKey
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'policy_versions_policyId_fkey'
    ) THEN
        ALTER TABLE "policy_versions" ADD CONSTRAINT "policy_versions_policyId_fkey" FOREIGN KEY ("policyId") REFERENCES "policies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

-- AddForeignKey
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'policy_versions_uploadedById_fkey'
    ) THEN
        ALTER TABLE "policy_versions" ADD CONSTRAINT "policy_versions_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "tenant_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    END IF;
END $$;

-- AddForeignKey
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'policy_versions_publishedById_fkey'
    ) THEN
        ALTER TABLE "policy_versions" ADD CONSTRAINT "policy_versions_publishedById_fkey" FOREIGN KEY ("publishedById") REFERENCES "tenant_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
END $$;

-- Backfill initial version for existing legacy policies
INSERT INTO "policy_versions" (
    "id",
    "tenantId",
    "policyId",
    "versionNumber",
    "versionString",
    "title",
    "description",
    "changeNotes",
    "content",
    "category",
    "status",
    "isCurrent",
    "pdfUrl",
    "pdfOriginalName",
    "contentHash",
    "effectiveDate",
    "expiryDate",
    "dueDate",
    "uploadedById",
    "publishedById",
    "publishedAt",
    "createdAt",
    "updatedAt"
)
SELECT
    'pv_' || substr(md5(random()::text || p."id"), 1, 22),
    p."tenantId",
    p."id",
    COALESCE(p."version", 1),
    COALESCE(p."version", 1)::text || '.0',
    p."title",
    p."description",
    'Initial published policy version',
    p."content",
    p."category",
    p."status",
    (p."status" = 'PUBLISHED'),
    p."pdfUrl",
    p."pdfOriginalName",
    p."contentHash",
    COALESCE(p."effectiveDate", p."createdAt"),
    p."expiryDate",
    p."dueDate",
    p."createdById",
    p."publishedById",
    p."publishedAt",
    p."createdAt",
    p."updatedAt"
FROM "policies" p
ON CONFLICT ("policyId", "versionNumber") DO NOTHING;

