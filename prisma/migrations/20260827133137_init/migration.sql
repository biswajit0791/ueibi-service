-- CreateEnum
CREATE TYPE "RegistrationStatus" AS ENUM ('PENDING_FINANCE_REVIEW', 'PENDING_CHEQUE_CONFIRMATION', 'PENDING_HR_ACTIVATION', 'ACTIVE');

-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('ONLINE', 'CHEQUE');

-- CreateEnum
CREATE TYPE "TokenRole" AS ENUM ('FINANCE', 'HR');

-- CreateEnum
CREATE TYPE "DiscountType" AS ENUM ('PERCENT', 'FLAT');

-- CreateTable
CREATE TABLE "users" (
    "id" SERIAL NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "company_registrations" (
    "id" TEXT NOT NULL,
    "companyName" TEXT NOT NULL,
    "companyType" TEXT NOT NULL,
    "domainName" TEXT NOT NULL,
    "tenantCode" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "designation" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "financeEmail" TEXT NOT NULL,
    "hrEmail" TEXT NOT NULL,
    "acceptedTermsAt" TIMESTAMP(3) NOT NULL,
    "gstin" TEXT,
    "licenseQuantity" INTEGER,
    "unitPrice" DECIMAL(10,2),
    "couponId" TEXT,
    "discountAmount" DECIMAL(10,2),
    "subtotalAmount" DECIMAL(10,2),
    "gstRate" DECIMAL(5,4),
    "gstAmount" DECIMAL(10,2),
    "totalAmount" DECIMAL(10,2),
    "paymentMethod" "PaymentMethod",
    "paymentReference" TEXT,
    "chequeNumber" TEXT,
    "chequeDate" TIMESTAMP(3),
    "transactionId" TEXT,
    "financeApprovedAt" TIMESTAMP(3),
    "activatedAt" TIMESTAMP(3),
    "status" "RegistrationStatus" NOT NULL DEFAULT 'PENDING_FINANCE_REVIEW',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "company_registrations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "email_verifications" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "domainName" TEXT NOT NULL,
    "otpHash" TEXT NOT NULL,
    "otpExpiresAt" TIMESTAMP(3) NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "verifiedAt" TIMESTAMP(3),
    "verificationToken" TEXT,
    "verificationTokenExpiresAt" TIMESTAMP(3),
    "consumedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "email_verifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "registration_action_tokens" (
    "id" TEXT NOT NULL,
    "registrationId" TEXT NOT NULL,
    "role" "TokenRole" NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "lastUsedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "registration_action_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "coupons" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "discountType" "DiscountType" NOT NULL,
    "discountValue" DECIMAL(10,2) NOT NULL,
    "bdmName" TEXT,
    "expiresAt" TIMESTAMP(3),
    "usageLimit" INTEGER,
    "timesUsed" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "coupons_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_logs" (
    "id" TEXT NOT NULL,
    "registrationId" TEXT,
    "event" TEXT NOT NULL,
    "recipient" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "bodyText" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "providerMessageId" TEXT,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notification_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "company_registrations_domainName_key" ON "company_registrations"("domainName");

-- CreateIndex
CREATE UNIQUE INDEX "company_registrations_tenantCode_key" ON "company_registrations"("tenantCode");

-- CreateIndex
CREATE UNIQUE INDEX "company_registrations_email_key" ON "company_registrations"("email");

-- CreateIndex
CREATE INDEX "company_registrations_status_idx" ON "company_registrations"("status");

-- CreateIndex
CREATE UNIQUE INDEX "email_verifications_verificationToken_key" ON "email_verifications"("verificationToken");

-- CreateIndex
CREATE INDEX "email_verifications_email_idx" ON "email_verifications"("email");

-- CreateIndex
CREATE UNIQUE INDEX "registration_action_tokens_tokenHash_key" ON "registration_action_tokens"("tokenHash");

-- CreateIndex
CREATE INDEX "registration_action_tokens_registrationId_role_idx" ON "registration_action_tokens"("registrationId", "role");

-- CreateIndex
CREATE UNIQUE INDEX "coupons_code_key" ON "coupons"("code");

-- CreateIndex
CREATE INDEX "notification_logs_registrationId_idx" ON "notification_logs"("registrationId");

-- CreateIndex
CREATE INDEX "notification_logs_event_idx" ON "notification_logs"("event");

-- AddForeignKey
ALTER TABLE "company_registrations" ADD CONSTRAINT "company_registrations_couponId_fkey" FOREIGN KEY ("couponId") REFERENCES "coupons"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "registration_action_tokens" ADD CONSTRAINT "registration_action_tokens_registrationId_fkey" FOREIGN KEY ("registrationId") REFERENCES "company_registrations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_logs" ADD CONSTRAINT "notification_logs_registrationId_fkey" FOREIGN KEY ("registrationId") REFERENCES "company_registrations"("id") ON DELETE SET NULL ON UPDATE CASCADE;
