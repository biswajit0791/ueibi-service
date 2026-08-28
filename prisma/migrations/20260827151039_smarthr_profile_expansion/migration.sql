/*
  Warnings:

  - You are about to drop the column `exitDate` on the `tenant_users` table. All the data in the column will be lost.

*/
-- CreateEnum
CREATE TYPE "EmploymentType" AS ENUM ('PERMANENT', 'CONTRACT', 'PROBATION', 'INTERN');

-- AlterTable
ALTER TABLE "tenant_users" DROP COLUMN "exitDate",
ADD COLUMN     "bloodGroup" TEXT,
ADD COLUMN     "confirmationDate" TIMESTAMP(3),
ADD COLUMN     "emergencyContact" TEXT,
ADD COLUMN     "empType" "EmploymentType" NOT NULL DEFAULT 'PERMANENT',
ADD COLUMN     "esic" TEXT,
ADD COLUMN     "gender" TEXT,
ADD COLUMN     "managerId" TEXT,
ADD COLUMN     "officeLocation" TEXT,
ADD COLUMN     "personalEmail" TEXT,
ADD COLUMN     "uan" TEXT;

-- CreateTable
CREATE TABLE "bank_details" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "bankName" TEXT NOT NULL,
    "accountNumber" TEXT NOT NULL,
    "ifscCode" TEXT NOT NULL,
    "branchName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "bank_details_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "work_histories" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "companyName" TEXT NOT NULL,
    "designation" TEXT NOT NULL,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3) NOT NULL,
    "reasonForExit" TEXT,
    "verifiedStatus" TEXT NOT NULL DEFAULT 'PENDING',

    CONSTRAINT "work_histories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "exit_details" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "resignationDate" TIMESTAMP(3) NOT NULL,
    "lastWorkingDay" TIMESTAMP(3) NOT NULL,
    "exitReason" TEXT NOT NULL,
    "feedbackRemarks" TEXT,
    "itCleared" BOOLEAN NOT NULL DEFAULT false,
    "hrCleared" BOOLEAN NOT NULL DEFAULT false,
    "financeCleared" BOOLEAN NOT NULL DEFAULT false,
    "settlementStatus" TEXT NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "exit_details_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "bank_details_userId_key" ON "bank_details"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "exit_details_userId_key" ON "exit_details"("userId");

-- AddForeignKey
ALTER TABLE "tenant_users" ADD CONSTRAINT "tenant_users_managerId_fkey" FOREIGN KEY ("managerId") REFERENCES "tenant_users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "bank_details" ADD CONSTRAINT "bank_details_userId_fkey" FOREIGN KEY ("userId") REFERENCES "tenant_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_histories" ADD CONSTRAINT "work_histories_userId_fkey" FOREIGN KEY ("userId") REFERENCES "tenant_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exit_details" ADD CONSTRAINT "exit_details_userId_fkey" FOREIGN KEY ("userId") REFERENCES "tenant_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
