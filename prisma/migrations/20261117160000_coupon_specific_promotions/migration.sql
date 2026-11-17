-- AlterTable
ALTER TABLE "subscription_promotions" ADD COLUMN IF NOT EXISTS "allowNoCoupon" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE IF NOT EXISTS "promotion_coupons" (
    "id" TEXT NOT NULL,
    "promotionId" TEXT NOT NULL,
    "couponId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "promotion_coupons_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "promotion_coupons_promotionId_couponId_key" ON "promotion_coupons"("promotionId", "couponId");
CREATE INDEX IF NOT EXISTS "promotion_coupons_promotionId_idx" ON "promotion_coupons"("promotionId");
CREATE INDEX IF NOT EXISTS "promotion_coupons_couponId_idx" ON "promotion_coupons"("couponId");

-- AddForeignKey
DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'promotion_coupons_promotionId_fkey'
    ) THEN
        ALTER TABLE "promotion_coupons" ADD CONSTRAINT "promotion_coupons_promotionId_fkey" FOREIGN KEY ("promotionId") REFERENCES "subscription_promotions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'promotion_coupons_couponId_fkey'
    ) THEN
        ALTER TABLE "promotion_coupons" ADD CONSTRAINT "promotion_coupons_couponId_fkey" FOREIGN KEY ("couponId") REFERENCES "coupons"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;
