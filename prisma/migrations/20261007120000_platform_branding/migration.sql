-- CreateTable
CREATE TABLE "platform_branding" (
    "id" TEXT NOT NULL DEFAULT 'singleton',
    "platformName" TEXT NOT NULL DEFAULT 'UEIBI',
    "tagline" TEXT NOT NULL DEFAULT 'Enterprise Operations & Governance',
    "badgeText" TEXT NOT NULL DEFAULT 'ENTERPRISE HUB',
    "logoUrl" TEXT,
    "logoDarkUrl" TEXT,
    "iconUrl" TEXT,
    "faviconUrl" TEXT,
    "primaryColor" TEXT NOT NULL DEFAULT '#4f46e5',
    "gradientStart" TEXT NOT NULL DEFAULT '#4f46e5',
    "gradientEnd" TEXT NOT NULL DEFAULT '#3b82f6',
    "copyrightText" TEXT NOT NULL DEFAULT 'UEIBI Platform Inc. All rights reserved.',
    "updatedById" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "platform_branding_pkey" PRIMARY KEY ("id")
);
