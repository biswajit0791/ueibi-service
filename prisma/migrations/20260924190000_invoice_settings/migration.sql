-- Invoice settings, and the designer's output on a template version.
--
-- Additive. No existing column is altered, and the 8 issued invoices keep their
-- numbers: nextNumber is a floor, not an override.

CREATE TABLE "invoice_settings" (
    "id"                   TEXT NOT NULL DEFAULT 'singleton',
    "numberPrefix"         TEXT NOT NULL DEFAULT 'UEIBI',
    "includeFinancialYear" BOOLEAN NOT NULL DEFAULT true,
    "nextNumber"           INTEGER NOT NULL DEFAULT 1,
    "currencyCode"         TEXT NOT NULL DEFAULT 'INR',
    "currencySymbol"       TEXT NOT NULL DEFAULT '₹',
    "symbolPosition"       TEXT NOT NULL DEFAULT 'BEFORE',
    "dateFormat"           TEXT NOT NULL DEFAULT 'DD MMM YYYY',
    "defaultPaymentTerms"  TEXT,
    "taxName"              TEXT NOT NULL DEFAULT 'GST',
    "taxPercent"           DECIMAL(5,2) NOT NULL DEFAULT 18,
    "issuerName"           TEXT NOT NULL DEFAULT 'UEIBI',
    "issuerGstin"          TEXT,
    "issuerAddress"        TEXT,
    "signatureUrl"         TEXT,
    "sealUrl"              TEXT,
    "updatedById"          TEXT,
    "updatedAt"            TIMESTAMP(3) NOT NULL,
    "createdAt"            TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "invoice_settings_pkey" PRIMARY KEY ("id")
);

-- The designer's output. Null on versions authored as raw HTML, which keep
-- rendering through bodyHtml exactly as they do today.
ALTER TABLE "invoice_template_versions" ADD COLUMN "settings" JSONB;
