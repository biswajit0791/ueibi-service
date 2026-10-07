/**
 * platformBranding.service.js — Platform-wide branding and logo configuration.
 *
 * Stores the platform name, logo URLs, favicon, badge text, and color scheme.
 * Operates as a singleton row in PostgreSQL with fallback defaults so that
 * the application never breaks even if no record is saved yet.
 */
import { prisma } from '../lib/prisma.js';

const SINGLETON = 'singleton';

let tableEnsured = false;
async function ensureTable(client = prisma) {
  if (tableEnsured) return;
  try {
    await client.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "platform_branding" (
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
        "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "platform_branding_pkey" PRIMARY KEY ("id")
      );
    `);
    tableEnsured = true;
  } catch (e) {
    // Table may already exist or user lacks DDL; continue gracefully
  }
}

/** Fallback values matching the current UEIBI theme */
export function fallbackBranding() {
  return {
    id: SINGLETON,
    platformName: 'UEIBI',
    tagline: 'Enterprise Operations & Governance',
    badgeText: 'ENTERPRISE HUB',
    logoUrl: null,
    logoDarkUrl: null,
    iconUrl: null,
    faviconUrl: null,
    primaryColor: '#4f46e5',
    gradientStart: '#4f46e5',
    gradientEnd: '#3b82f6',
    copyrightText: 'UEIBI Platform Inc. All rights reserved.',
    updatedById: null,
    updatedAt: null,
    isDefault: true,
  };
}

const toPlain = (row) => ({
  id: row.id || SINGLETON,
  platformName: row.platformName || 'UEIBI',
  tagline: row.tagline || 'Enterprise Operations & Governance',
  badgeText: row.badgeText || 'ENTERPRISE HUB',
  logoUrl: row.logoUrl || null,
  logoDarkUrl: row.logoDarkUrl || null,
  iconUrl: row.iconUrl || null,
  faviconUrl: row.faviconUrl || null,
  primaryColor: row.primaryColor || '#4f46e5',
  gradientStart: row.gradientStart || '#4f46e5',
  gradientEnd: row.gradientEnd || '#3b82f6',
  copyrightText: row.copyrightText || 'UEIBI Platform Inc. All rights reserved.',
  updatedById: row.updatedById || null,
  updatedAt: row.updatedAt || null,
  isDefault: false,
});

/** Retrieves current platform branding with graceful fallback */
export async function getPlatformBranding(client = prisma) {
  try {
    await ensureTable(client);
    if (client.platformBranding) {
      const row = await client.platformBranding.findUnique({ where: { id: SINGLETON } });
      return row ? toPlain(row) : fallbackBranding();
    }
    // Fallback direct raw query if Prisma client has not regenerated yet
    const rows = await client.$queryRawUnsafe(`SELECT * FROM "platform_branding" WHERE id = $1 LIMIT 1`, SINGLETON);
    return rows && rows.length > 0 ? toPlain(rows[0]) : fallbackBranding();
  } catch (err) {
    console.warn('[Branding] Failed to read platform_branding row, using fallback:', err.message);
    return fallbackBranding();
  }
}

/** Saves / updates platform branding */
export async function savePlatformBranding(data, updatedById, client = prisma) {
  await ensureTable(client);
  const now = new Date();
  const payload = {
    platformName: data.platformName?.trim() || 'UEIBI',
    tagline: data.tagline?.trim() || 'Enterprise Operations & Governance',
    badgeText: data.badgeText?.trim() || 'ENTERPRISE HUB',
    logoUrl: data.logoUrl || null,
    logoDarkUrl: data.logoDarkUrl || null,
    iconUrl: data.iconUrl || null,
    faviconUrl: data.faviconUrl || null,
    primaryColor: data.primaryColor || '#4f46e5',
    gradientStart: data.gradientStart || '#4f46e5',
    gradientEnd: data.gradientEnd || '#3b82f6',
    copyrightText: data.copyrightText?.trim() || 'UEIBI Platform Inc. All rights reserved.',
    updatedById: updatedById || null,
  };

  try {
    if (client.platformBranding) {
      const row = await client.platformBranding.upsert({
        where: { id: SINGLETON },
        create: { id: SINGLETON, ...payload },
        update: { ...payload },
      });
      return toPlain(row);
    }
  } catch (prismaErr) {
    // Continue to raw upsert below if Prisma model not regenerated
  }

  // Safe raw SQL upsert
  await client.$executeRawUnsafe(
    `INSERT INTO "platform_branding"
      ("id", "platformName", "tagline", "badgeText", "logoUrl", "logoDarkUrl", "iconUrl", "faviconUrl", "primaryColor", "gradientStart", "gradientEnd", "copyrightText", "updatedById", "updatedAt")
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
     ON CONFLICT ("id") DO UPDATE SET
      "platformName" = EXCLUDED."platformName",
      "tagline" = EXCLUDED."tagline",
      "badgeText" = EXCLUDED."badgeText",
      "logoUrl" = EXCLUDED."logoUrl",
      "logoDarkUrl" = EXCLUDED."logoDarkUrl",
      "iconUrl" = EXCLUDED."iconUrl",
      "faviconUrl" = EXCLUDED."faviconUrl",
      "primaryColor" = EXCLUDED."primaryColor",
      "gradientStart" = EXCLUDED."gradientStart",
      "gradientEnd" = EXCLUDED."gradientEnd",
      "copyrightText" = EXCLUDED."copyrightText",
      "updatedById" = EXCLUDED."updatedById",
      "updatedAt" = EXCLUDED."updatedAt";`,
    SINGLETON,
    payload.platformName,
    payload.tagline,
    payload.badgeText,
    payload.logoUrl,
    payload.logoDarkUrl,
    payload.iconUrl,
    payload.faviconUrl,
    payload.primaryColor,
    payload.gradientStart,
    payload.gradientEnd,
    payload.copyrightText,
    payload.updatedById,
    now
  );

  return toPlain({ id: SINGLETON, ...payload, updatedAt: now });
}

/** Resets platform branding to original defaults */
export async function resetPlatformBranding(updatedById, client = prisma) {
  const defaults = fallbackBranding();
  return savePlatformBranding(defaults, updatedById, client);
}
