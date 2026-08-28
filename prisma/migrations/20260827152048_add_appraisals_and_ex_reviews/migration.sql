-- CreateTable
CREATE TABLE "appraisal_cycles" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "appraisal_cycles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "performance_reviews" (
    "id" TEXT NOT NULL,
    "cycleId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "selfRating" DECIMAL(3,2),
    "selfRemarks" TEXT,
    "managerRating" DECIMAL(3,2),
    "managerRemarks" TEXT,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "performance_reviews_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ex_employer_reviews" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "exCompany" TEXT NOT NULL,
    "exManagerName" TEXT NOT NULL,
    "exManagerEmail" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "rating" DECIMAL(3,2),
    "feedback" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ex_employer_reviews_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "performance_reviews_employeeId_idx" ON "performance_reviews"("employeeId");

-- CreateIndex
CREATE INDEX "performance_reviews_cycleId_idx" ON "performance_reviews"("cycleId");

-- CreateIndex
CREATE UNIQUE INDEX "ex_employer_reviews_token_key" ON "ex_employer_reviews"("token");

-- CreateIndex
CREATE INDEX "ex_employer_reviews_employeeId_idx" ON "ex_employer_reviews"("employeeId");

-- AddForeignKey
ALTER TABLE "performance_reviews" ADD CONSTRAINT "performance_reviews_cycleId_fkey" FOREIGN KEY ("cycleId") REFERENCES "appraisal_cycles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "performance_reviews" ADD CONSTRAINT "performance_reviews_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "tenant_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ex_employer_reviews" ADD CONSTRAINT "ex_employer_reviews_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "tenant_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
