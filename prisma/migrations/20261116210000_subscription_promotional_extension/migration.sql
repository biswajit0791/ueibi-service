-- CreateTable: subscription_promotions
CREATE TABLE IF NOT EXISTS "subscription_promotions" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "code" TEXT,
    "paidMonths" INTEGER NOT NULL DEFAULT 12,
    "freeMonths" INTEGER NOT NULL DEFAULT 2,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "startsAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3),
    "applyToAllPackages" BOOLEAN NOT NULL DEFAULT true,
    "packageIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "eligibility" TEXT NOT NULL DEFAULT 'ALL',
    "usageLimit" INTEGER,
    "timesUsed" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "subscription_promotions_pkey" PRIMARY KEY ("id")
);

-- Unique index on promotion code
CREATE UNIQUE INDEX IF NOT EXISTS "subscription_promotions_code_key" ON "subscription_promotions"("code");
CREATE INDEX IF NOT EXISTS "subscription_promotions_active_startsAt_expiresAt_idx" ON "subscription_promotions"("active", "startsAt", "expiresAt");

-- Add promotion tracking columns to subscriptions
ALTER TABLE "subscriptions" ADD COLUMN IF NOT EXISTS "promotionId" TEXT;
ALTER TABLE "subscriptions" ADD COLUMN IF NOT EXISTS "paidDurationMonths" INTEGER;
ALTER TABLE "subscriptions" ADD COLUMN IF NOT EXISTS "freeDurationMonths" INTEGER DEFAULT 0;
ALTER TABLE "subscriptions" ADD COLUMN IF NOT EXISTS "totalDurationMonths" INTEGER;
ALTER TABLE "subscriptions" ADD COLUMN IF NOT EXISTS "paidEndsAt" TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "subscriptions_promotionId_idx" ON "subscriptions"("promotionId");

-- Foreign key constraint for subscriptions -> subscription_promotions
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'subscriptions_promotionId_fkey'
    ) THEN
        ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_promotionId_fkey"
            FOREIGN KEY ("promotionId") REFERENCES "subscription_promotions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
END $$;

-- CreateTable: promotion_redemptions
CREATE TABLE IF NOT EXISTS "promotion_redemptions" (
    "id" TEXT NOT NULL,
    "promotionId" TEXT NOT NULL,
    "subscriptionId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "salesRepId" TEXT,
    "paidMonths" INTEGER NOT NULL,
    "freeMonths" INTEGER NOT NULL,
    "totalMonths" INTEGER NOT NULL,
    "paidRevenue" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "appliedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "promotion_redemptions_pkey" PRIMARY KEY ("id")
);

-- Indexes for promotion_redemptions
CREATE UNIQUE INDEX IF NOT EXISTS "promotion_redemptions_subscriptionId_key" ON "promotion_redemptions"("subscriptionId");
CREATE INDEX IF NOT EXISTS "promotion_redemptions_promotionId_idx" ON "promotion_redemptions"("promotionId");
CREATE INDEX IF NOT EXISTS "promotion_redemptions_tenantId_idx" ON "promotion_redemptions"("tenantId");
CREATE INDEX IF NOT EXISTS "promotion_redemptions_salesRepId_idx" ON "promotion_redemptions"("salesRepId");

-- Foreign keys for promotion_redemptions
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'promotion_redemptions_promotionId_fkey'
    ) THEN
        ALTER TABLE "promotion_redemptions" ADD CONSTRAINT "promotion_redemptions_promotionId_fkey"
            FOREIGN KEY ("promotionId") REFERENCES "subscription_promotions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'promotion_redemptions_subscriptionId_fkey'
    ) THEN
        ALTER TABLE "promotion_redemptions" ADD CONSTRAINT "promotion_redemptions_subscriptionId_fkey"
            FOREIGN KEY ("subscriptionId") REFERENCES "subscriptions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'promotion_redemptions_tenantId_fkey'
    ) THEN
        ALTER TABLE "promotion_redemptions" ADD CONSTRAINT "promotion_redemptions_tenantId_fkey"
            FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'promotion_redemptions_salesRepId_fkey'
    ) THEN
        ALTER TABLE "promotion_redemptions" ADD CONSTRAINT "promotion_redemptions_salesRepId_fkey"
            FOREIGN KEY ("salesRepId") REFERENCES "tenant_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
END $$;

-- Seed default initial promotion offer
INSERT INTO "subscription_promotions" (
    "id", "name", "description", "code", "paidMonths", "freeMonths",
    "active", "startsAt", "applyToAllPackages", "packageIds", "eligibility",
    "createdAt", "updatedAt"
) VALUES (
    'promo_annual_12_plus_2',
    'Annual Booster: Buy 12 Get 2 Months Free',
    'Pay standard 12 months rate and receive 2 additional promotional months free. Total 14 calendar months access.',
    'BOOST12PLUS2',
    12,
    2,
    true,
    CURRENT_TIMESTAMP,
    true,
    ARRAY[]::TEXT[],
    'ALL',
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
) ON CONFLICT ("id") DO NOTHING;

