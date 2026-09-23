-- A draft invoice must not consume an invoice number.
--
-- The GST series has to be unbroken per issuer, and an abandoned draft holding
-- number 0007 leaves a gap that an auditor will ask about. The number is now
-- allocated at the moment of issue instead, so drafts carry NULL.
--
-- Postgres permits many NULLs under a unique index, so the existing
-- invoices_invoiceNumber_key keeps guaranteeing uniqueness for real numbers
-- while any number of drafts coexist. No index change is needed.
--
-- Safe as written: there are no invoice rows yet.

ALTER TABLE "invoices" ALTER COLUMN "invoiceNumber" DROP NOT NULL;
