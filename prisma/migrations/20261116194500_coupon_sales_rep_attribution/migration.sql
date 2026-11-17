-- AlterTable: Add salesRepId to coupons
ALTER TABLE "coupons" ADD COLUMN IF NOT EXISTS "salesRepId" TEXT;

-- CreateIndex
CREATE INDEX IF NOT EXISTS "coupons_salesRepId_idx" ON "coupons"("salesRepId");

-- AddForeignKey
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'coupons_salesRepId_fkey'
  ) THEN
    ALTER TABLE "coupons" ADD CONSTRAINT "coupons_salesRepId_fkey" 
      FOREIGN KEY ("salesRepId") REFERENCES "tenant_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

