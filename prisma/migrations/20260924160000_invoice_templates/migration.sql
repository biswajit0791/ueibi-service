-- Invoice templates: the printed invoice, authored rather than hardcoded.
--
-- Additive. Existing invoices get a nullable templateVersionId and keep
-- rendering through the built-in layout until a template is published.

CREATE TABLE "invoice_templates" (
    "slug"        TEXT NOT NULL,
    "title"       TEXT NOT NULL,
    "description" TEXT,
    "isDefault"   BOOLEAN NOT NULL DEFAULT false,
    "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"   TIMESTAMP(3) NOT NULL,
    CONSTRAINT "invoice_templates_pkey" PRIMARY KEY ("slug")
);
CREATE INDEX "invoice_templates_isDefault_idx" ON "invoice_templates"("isDefault");

CREATE TABLE "invoice_template_versions" (
    "id"           TEXT NOT NULL,
    "templateSlug" TEXT NOT NULL,
    "version"      INTEGER NOT NULL,
    "title"        TEXT NOT NULL,
    "bodyHtml"     TEXT NOT NULL,
    "css"          TEXT,
    "changeNote"   TEXT,
    "publishedAt"  TIMESTAMP(3),
    "authorId"     TEXT NOT NULL,
    "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"    TIMESTAMP(3) NOT NULL,
    CONSTRAINT "invoice_template_versions_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "invoice_template_versions_templateSlug_version_key"
    ON "invoice_template_versions"("templateSlug", "version");
CREATE INDEX "invoice_template_versions_templateSlug_publishedAt_idx"
    ON "invoice_template_versions"("templateSlug", "publishedAt");

ALTER TABLE "invoice_template_versions" ADD CONSTRAINT "invoice_template_versions_templateSlug_fkey"
    FOREIGN KEY ("templateSlug") REFERENCES "invoice_templates"("slug") ON DELETE CASCADE ON UPDATE CASCADE;

-- An invoice remembers which version rendered it, so reprinting an old invoice
-- reproduces the customer's copy rather than today's design.
ALTER TABLE "invoices" ADD COLUMN "templateVersionId" TEXT;
-- SET NULL, not RESTRICT: losing the template must never make an invoice
-- unreadable; it falls back to the built-in layout.
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_templateVersionId_fkey"
    FOREIGN KEY ("templateVersionId") REFERENCES "invoice_template_versions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
