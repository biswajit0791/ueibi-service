-- AlterEnum
ALTER TYPE "UserRole" ADD VALUE 'ADMIN';

-- CreateTable
CREATE TABLE "ex_employee_records" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "pan" TEXT NOT NULL,
    "dob" TEXT,
    "designation" TEXT NOT NULL,
    "department" TEXT NOT NULL,
    "serviceStart" TIMESTAMP(3) NOT NULL,
    "serviceEnd" TIMESTAMP(3) NOT NULL,
    "exitReason" TEXT NOT NULL,
    "techRating" INTEGER NOT NULL,
    "attitudeRating" INTEGER NOT NULL,
    "conductValue" TEXT NOT NULL,
    "feedback" TEXT NOT NULL,
    "submittedBy" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'Submitted',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ex_employee_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "non_joiner_records" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "pan" TEXT NOT NULL,
    "dob" TEXT,
    "designation" TEXT NOT NULL,
    "department" TEXT NOT NULL,
    "offerReleaseDate" TIMESTAMP(3) NOT NULL,
    "dateOfJoining" TIMESTAMP(3) NOT NULL,
    "salary" TEXT NOT NULL,
    "offerAccepted" TEXT NOT NULL,
    "submittedBy" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'Submitted',
    "feedback" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "non_joiner_records_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ex_employee_records_tenantId_idx" ON "ex_employee_records"("tenantId");

-- CreateIndex
CREATE INDEX "ex_employee_records_pan_idx" ON "ex_employee_records"("pan");

-- CreateIndex
CREATE INDEX "ex_employee_records_email_idx" ON "ex_employee_records"("email");

-- CreateIndex
CREATE INDEX "non_joiner_records_tenantId_idx" ON "non_joiner_records"("tenantId");

-- CreateIndex
CREATE INDEX "non_joiner_records_pan_idx" ON "non_joiner_records"("pan");

-- CreateIndex
CREATE INDEX "non_joiner_records_email_idx" ON "non_joiner_records"("email");

-- AddForeignKey
ALTER TABLE "ex_employee_records" ADD CONSTRAINT "ex_employee_records_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "non_joiner_records" ADD CONSTRAINT "non_joiner_records_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
