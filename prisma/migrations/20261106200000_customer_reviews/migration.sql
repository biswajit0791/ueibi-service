-- CreateTable
CREATE TABLE IF NOT EXISTS "customer_reviews" (
    "id" TEXT NOT NULL,
    "companyName" TEXT NOT NULL,
    "clientName" TEXT NOT NULL,
    "designation" TEXT,
    "avatarUrl" TEXT,
    "rating" INTEGER NOT NULL DEFAULT 5,
    "headline" TEXT,
    "reviewText" TEXT NOT NULL,
    "isFeatured" BOOLEAN NOT NULL DEFAULT false,
    "isPublished" BOOLEAN NOT NULL DEFAULT true,
    "orderIndex" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "customer_reviews_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "customer_reviews_isPublished_isFeatured_idx" ON "customer_reviews"("isPublished", "isFeatured");

