-- AlterTable
ALTER TABLE "subscriptions" ADD COLUMN "salesRepId" TEXT;

-- CreateIndex
CREATE INDEX "subscriptions_salesRepId_idx" ON "subscriptions"("salesRepId");

-- AddForeignKey
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_salesRepId_fkey" FOREIGN KEY ("salesRepId") REFERENCES "tenant_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

