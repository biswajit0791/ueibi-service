-- Billing: term licences, invoices and recorded payments.
--
-- Entirely additive. No existing column is altered or dropped, and
-- company_registrations keeps its money fields and stays the signup record —
-- companies mid-onboarding must not be disturbed by this.

-- ── Enums ───────────────────────────────────────────────────────────────────

CREATE TYPE "BillingInterval"   AS ENUM ('ONE_TIME', 'MONTHLY', 'QUARTERLY', 'ANNUAL');
CREATE TYPE "SubscriptionState" AS ENUM ('PENDING', 'ACTIVE', 'EXPIRED', 'CANCELLED');
CREATE TYPE "InvoiceState"      AS ENUM ('DRAFT', 'ISSUED', 'PARTIALLY_PAID', 'PAID', 'VOID');
CREATE TYPE "RefundState"       AS ENUM ('RECORDED', 'REJECTED');

-- Appended, never reordered: existing rows hold ONLINE or CHEQUE and their
-- stored value must keep meaning exactly what it meant before.
ALTER TYPE "PaymentMethod" ADD VALUE IF NOT EXISTS 'BANK_TRANSFER';
ALTER TYPE "PaymentMethod" ADD VALUE IF NOT EXISTS 'UPI';
ALTER TYPE "PaymentMethod" ADD VALUE IF NOT EXISTS 'CASH';
ALTER TYPE "PaymentMethod" ADD VALUE IF NOT EXISTS 'ADJUSTMENT';
ALTER TYPE "PaymentMethod" ADD VALUE IF NOT EXISTS 'LEGACY';

-- ── packages ────────────────────────────────────────────────────────────────

CREATE TABLE "packages" (
    "id"          TEXT NOT NULL,
    "name"        TEXT NOT NULL,
    "description" TEXT,
    "seatCount"   INTEGER NOT NULL,
    "interval"    "BillingInterval" NOT NULL DEFAULT 'ANNUAL',
    "termMonths"  INTEGER,
    "unitPrice"   DECIMAL(10,2) NOT NULL,
    "currency"    TEXT NOT NULL DEFAULT 'INR',
    "active"      BOOLEAN NOT NULL DEFAULT true,
    "sortOrder"   INTEGER NOT NULL DEFAULT 0,
    "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"   TIMESTAMP(3) NOT NULL,
    CONSTRAINT "packages_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "packages_active_sortOrder_idx" ON "packages"("active", "sortOrder");

-- ── subscriptions ───────────────────────────────────────────────────────────

CREATE TABLE "subscriptions" (
    "id"             TEXT NOT NULL,
    "tenantId"       TEXT NOT NULL,
    "packageId"      TEXT,
    "packageName"    TEXT NOT NULL,
    "seatCount"      INTEGER NOT NULL,
    "state"          "SubscriptionState" NOT NULL DEFAULT 'PENDING',
    "startsAt"       TIMESTAMP(3) NOT NULL,
    "endsAt"         TIMESTAMP(3),
    "renewedFromId"  TEXT,
    "registrationId" TEXT,
    "cancelledAt"    TIMESTAMP(3),
    "cancelReason"   TEXT,
    "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"      TIMESTAMP(3) NOT NULL,
    CONSTRAINT "subscriptions_pkey" PRIMARY KEY ("id")
);
-- One term can only be renewed once, which is what makes the chain a chain.
CREATE UNIQUE INDEX "subscriptions_renewedFromId_key" ON "subscriptions"("renewedFromId");
CREATE INDEX "subscriptions_tenantId_startsAt_idx" ON "subscriptions"("tenantId", "startsAt");
CREATE INDEX "subscriptions_state_idx" ON "subscriptions"("state");
CREATE INDEX "subscriptions_endsAt_idx" ON "subscriptions"("endsAt");

ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_packageId_fkey"
    FOREIGN KEY ("packageId") REFERENCES "packages"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_renewedFromId_fkey"
    FOREIGN KEY ("renewedFromId") REFERENCES "subscriptions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ── invoices ────────────────────────────────────────────────────────────────

CREATE TABLE "invoices" (
    "id"             TEXT NOT NULL,
    "invoiceNumber"  TEXT NOT NULL,
    "tenantId"       TEXT NOT NULL,
    "subscriptionId" TEXT,
    "registrationId" TEXT,
    "state"          "InvoiceState" NOT NULL DEFAULT 'DRAFT',
    "billToName"     TEXT NOT NULL,
    "billToGstin"    TEXT,
    "billToEmail"    TEXT NOT NULL,
    "issuedAt"       TIMESTAMP(3),
    "dueAt"          TIMESTAMP(3),
    "currency"       TEXT NOT NULL DEFAULT 'INR',
    "quantity"       INTEGER NOT NULL,
    "unitPrice"      DECIMAL(10,2) NOT NULL,
    "subtotalAmount" DECIMAL(10,2) NOT NULL,
    "couponId"       TEXT,
    "couponCode"     TEXT,
    "discountAmount" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "gstRate"        DECIMAL(5,4) NOT NULL,
    "gstAmount"      DECIMAL(10,2) NOT NULL,
    "totalAmount"    DECIMAL(10,2) NOT NULL,
    "amountPaid"     DECIMAL(10,2) NOT NULL DEFAULT 0,
    "amountRefunded" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "notes"          TEXT,
    "voidedAt"       TIMESTAMP(3),
    "voidReason"     TEXT,
    "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"      TIMESTAMP(3) NOT NULL,
    CONSTRAINT "invoices_pkey" PRIMARY KEY ("id")
);
-- The GST series must be unbroken per issuer, so this is global rather than
-- per tenant. Under concurrency THIS is what guarantees it, not the max+1 read.
CREATE UNIQUE INDEX "invoices_invoiceNumber_key" ON "invoices"("invoiceNumber");
CREATE INDEX "invoices_tenantId_issuedAt_idx" ON "invoices"("tenantId", "issuedAt");
CREATE INDEX "invoices_state_idx" ON "invoices"("state");

ALTER TABLE "invoices" ADD CONSTRAINT "invoices_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_subscriptionId_fkey"
    FOREIGN KEY ("subscriptionId") REFERENCES "subscriptions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ── payments ────────────────────────────────────────────────────────────────

CREATE TABLE "payments" (
    "id"           TEXT NOT NULL,
    "invoiceId"    TEXT NOT NULL,
    "tenantId"     TEXT NOT NULL,
    "amount"       DECIMAL(10,2) NOT NULL,
    "method"       "PaymentMethod" NOT NULL,
    "reference"    TEXT,
    "receivedAt"   TIMESTAMP(3) NOT NULL,
    "recordedById" TEXT NOT NULL,
    "notes"        TEXT,
    "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "payments_invoiceId_idx" ON "payments"("invoiceId");
CREATE INDEX "payments_tenantId_receivedAt_idx" ON "payments"("tenantId", "receivedAt");
CREATE INDEX "payments_method_idx" ON "payments"("method");

ALTER TABLE "payments" ADD CONSTRAINT "payments_invoiceId_fkey"
    FOREIGN KEY ("invoiceId") REFERENCES "invoices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ── refunds ─────────────────────────────────────────────────────────────────

CREATE TABLE "refunds" (
    "id"           TEXT NOT NULL,
    "invoiceId"    TEXT NOT NULL,
    "paymentId"    TEXT,
    "tenantId"     TEXT NOT NULL,
    "amount"       DECIMAL(10,2) NOT NULL,
    "reason"       TEXT NOT NULL,
    "method"       "PaymentMethod" NOT NULL,
    "reference"    TEXT,
    "state"        "RefundState" NOT NULL DEFAULT 'RECORDED',
    "refundedAt"   TIMESTAMP(3) NOT NULL,
    "recordedById" TEXT NOT NULL,
    "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "refunds_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "refunds_invoiceId_idx" ON "refunds"("invoiceId");
CREATE INDEX "refunds_tenantId_refundedAt_idx" ON "refunds"("tenantId", "refundedAt");

ALTER TABLE "refunds" ADD CONSTRAINT "refunds_invoiceId_fkey"
    FOREIGN KEY ("invoiceId") REFERENCES "invoices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_paymentId_fkey"
    FOREIGN KEY ("paymentId") REFERENCES "payments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ── coupon_redemptions ──────────────────────────────────────────────────────

CREATE TABLE "coupon_redemptions" (
    "id"             TEXT NOT NULL,
    "couponId"       TEXT NOT NULL,
    "invoiceId"      TEXT,
    "tenantId"       TEXT,
    "registrationId" TEXT,
    "discountAmount" DECIMAL(10,2) NOT NULL,
    "redeemedAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "coupon_redemptions_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "coupon_redemptions_couponId_redeemedAt_idx" ON "coupon_redemptions"("couponId", "redeemedAt");

ALTER TABLE "coupon_redemptions" ADD CONSTRAINT "coupon_redemptions_couponId_fkey"
    FOREIGN KEY ("couponId") REFERENCES "coupons"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "coupon_redemptions" ADD CONSTRAINT "coupon_redemptions_invoiceId_fkey"
    FOREIGN KEY ("invoiceId") REFERENCES "invoices"("id") ON DELETE SET NULL ON UPDATE CASCADE;
