-- AlterTable: add dynamic configuration, stacking and audit fields to subscription_promotions
ALTER TABLE "subscription_promotions"
  ADD COLUMN IF NOT EXISTS "badgeText" VARCHAR(100),
  ADD COLUMN IF NOT EXISTS "minSeats" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS "priority" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "allowCoupons" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS "isArchived" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "createdById" VARCHAR(100),
  ADD COLUMN IF NOT EXISTS "updatedById" VARCHAR(100);

-- AlterTable: add complete immutable audit snapshot fields to promotion_redemptions
ALTER TABLE "promotion_redemptions"
  ADD COLUMN IF NOT EXISTS "promotionName" VARCHAR(255),
  ADD COLUMN IF NOT EXISTS "promoCode" VARCHAR(100),
  ADD COLUMN IF NOT EXISTS "originalEndsAt" TIMESTAMPTZ(3),
  ADD COLUMN IF NOT EXISTS "finalEndsAt" TIMESTAMPTZ(3),
  ADD COLUMN IF NOT EXISTS "seatCount" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS "unitPrice" DECIMAL(10, 2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "couponCode" VARCHAR(100),
  ADD COLUMN IF NOT EXISTS "couponDiscount" DECIMAL(10, 2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "gstAmount" DECIMAL(10, 2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "netPayable" DECIMAL(10, 2) NOT NULL DEFAULT 0;

-- Backfill existing promotion_redemptions snapshots from linked promotion & subscription if null
UPDATE "promotion_redemptions" r
SET
  "promotionName" = COALESCE(r."promotionName", p."name"),
  "promoCode" = COALESCE(r."promoCode", p."code"),
  "seatCount" = COALESCE(s."seatCount", 1),
  "finalEndsAt" = COALESCE(s."endsAt", r."appliedAt")
FROM "subscription_promotions" p, "subscriptions" s
WHERE r."promotionId" = p."id" AND r."subscriptionId" = s."id";

-- Index for fast priority-based active promotions discovery
CREATE INDEX IF NOT EXISTS "subscription_promotions_priority_idx"
  ON "subscription_promotions" ("priority" DESC, "isArchived", "active");
