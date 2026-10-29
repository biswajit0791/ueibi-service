-- AlterTable
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "creditBalance" DECIMAL(10,2) NOT NULL DEFAULT 0.00;

-- AlterTable
ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "creditRedeemed" DECIMAL(10,2) NOT NULL DEFAULT 0.00;

-- CreateTable
CREATE TABLE IF NOT EXISTS "wallet_transactions" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "balanceAfter" DECIMAL(10,2) NOT NULL,
    "seatsRetracted" INTEGER,
    "unitCredit" DECIMAL(10,2),
    "remainingMonths" INTEGER,
    "description" TEXT,
    "referenceId" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "wallet_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "wallet_transactions_tenantId_createdAt_idx" ON "wallet_transactions"("tenantId", "createdAt");

-- AddForeignKey
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'wallet_transactions_tenantId_fkey'
    ) THEN
        ALTER TABLE "wallet_transactions" ADD CONSTRAINT "wallet_transactions_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

-- AddForeignKey
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'wallet_transactions_createdById_fkey'
    ) THEN
        ALTER TABLE "wallet_transactions" ADD CONSTRAINT "wallet_transactions_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "tenant_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
END $$;

