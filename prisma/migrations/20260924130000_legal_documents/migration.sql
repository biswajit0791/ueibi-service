-- Legal documents: the User Agreement and Privacy Policy shown at signup.
--
-- Entirely additive. Nothing existing is altered; company_registrations keeps
-- acceptedTermsAt exactly as it is, and the new legal_acceptances table records
-- WHICH version was accepted alongside it.

CREATE TABLE "legal_documents" (
    "slug"        TEXT NOT NULL,
    "title"       TEXT NOT NULL,
    "description" TEXT,
    "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"   TIMESTAMP(3) NOT NULL,
    CONSTRAINT "legal_documents_pkey" PRIMARY KEY ("slug")
);

CREATE TABLE "legal_document_versions" (
    "id"           TEXT NOT NULL,
    "documentSlug" TEXT NOT NULL,
    "version"      INTEGER NOT NULL,
    "title"        TEXT NOT NULL,
    "bodyHtml"     TEXT NOT NULL,
    "changeNote"   TEXT,
    "publishedAt"  TIMESTAMP(3),
    "authorId"     TEXT NOT NULL,
    "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"    TIMESTAMP(3) NOT NULL,
    CONSTRAINT "legal_document_versions_pkey" PRIMARY KEY ("id")
);
-- Two concurrent publishes cannot both claim version 3.
CREATE UNIQUE INDEX "legal_document_versions_documentSlug_version_key"
    ON "legal_document_versions"("documentSlug", "version");
CREATE INDEX "legal_document_versions_documentSlug_publishedAt_idx"
    ON "legal_document_versions"("documentSlug", "publishedAt");

CREATE TABLE "legal_acceptances" (
    "id"             TEXT NOT NULL,
    "versionId"      TEXT NOT NULL,
    "registrationId" TEXT,
    "tenantId"       TEXT,
    "userId"         TEXT,
    "acceptedAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ipAddress"      TEXT,
    "userAgent"      TEXT,
    CONSTRAINT "legal_acceptances_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "legal_acceptances_registrationId_idx" ON "legal_acceptances"("registrationId");
CREATE INDEX "legal_acceptances_versionId_idx" ON "legal_acceptances"("versionId");

ALTER TABLE "legal_document_versions" ADD CONSTRAINT "legal_document_versions_documentSlug_fkey"
    FOREIGN KEY ("documentSlug") REFERENCES "legal_documents"("slug") ON DELETE CASCADE ON UPDATE CASCADE;
-- RESTRICT: a version that somebody accepted must never be deletable, or the
-- evidence of what they agreed to goes with it.
ALTER TABLE "legal_acceptances" ADD CONSTRAINT "legal_acceptances_versionId_fkey"
    FOREIGN KEY ("versionId") REFERENCES "legal_document_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
