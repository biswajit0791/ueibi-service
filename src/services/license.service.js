/**
 * @file license.service.js
 * @description Centralized, single-source-of-truth for all employee license capacity
 *   calculations. Every controller must use these helpers instead of duplicating
 *   count() queries.
 *
 * License Rule (canonical definition):
 *   Only non-deleted TenantUser records with status IN ['ACTIVE', 'INVITED']
 *   consume a license slot for the given tenant.
 *
 *   ExEmployeeRecord and NonJoinerRecord rows NEVER consume a license.
 */

import { prisma } from '../lib/prisma.js';

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Returns a complete license + employee statistics snapshot for a tenant.
 * Does NOT need a transaction – safe to run outside any tx context.
 *
 * @param {string} tenantId
 * @returns {Promise<{
 *   totalCapacity: number,
 *   activeEmployees: number,
 *   availableLicenses: number,
 *   exEmployees: number,
 *   nonJoiners: number,
 *   databaseIntegrity: number,   // 0–100 % of active users that have a PAN on file
 * }>}
 */
export async function getLicenseStats(tenantId) {
  const [tenant, activeEmployees, exEmployees, nonJoiners, verifiedWithPan] =
    await Promise.all([
      // 1. Tenant row (for licenseLimit)
      prisma.tenant.findUnique({
        where: { id: tenantId },
        select: { licenseLimit: true },
      }),

      // 2. Active employee count (the canonical licence-consuming count)
      prisma.tenantUser.count({
        where: {
          tenantId,
          isDeleted: false,
          status: { in: ['ACTIVE', 'INVITED'] },
        },
      }),

      // 3. Ex-employee records count
      prisma.exEmployeeRecord.count({
        where: { tenantId, isDeleted: false },
      }),

      // 4. Non-joiner records count
      prisma.nonJoinerRecord.count({
        where: { tenantId, isDeleted: false },
      }),

      // 5. How many active users have a PAN (for Database Integrity metric)
      prisma.tenantUser.count({
        where: {
          tenantId,
          isDeleted: false,
          status: { in: ['ACTIVE', 'INVITED'] },
          pan: { not: null },
        },
      }),
    ]);

  const totalCapacity = tenant?.licenseLimit ?? 0;
  const availableLicenses = Math.max(0, totalCapacity - activeEmployees);

  // Database Integrity — percentage of active employees who have submitted a PAN.
  const databaseIntegrity =
    activeEmployees > 0
      ? Math.round((verifiedWithPan / activeEmployees) * 1000) / 10  // 1 decimal place
      : 100;

  return {
    totalCapacity,
    activeEmployees,
    availableLicenses,
    exEmployees,
    nonJoiners,
    databaseIntegrity,
  };
}

/**
 * Asserts that the tenant has at least ONE available license slot.
 * Must be called inside a Prisma interactive transaction so that the count
 * and the subsequent create() are atomic and protected against race conditions.
 *
 * Throws a structured Error with { code: 'LICENSE_LIMIT_REACHED', statusCode: 400 }
 * if no slots are available, which the global error handler (or the
 * calling controller) must propagate as HTTP 400.
 *
 * @param {import('@prisma/client').PrismaClient} tx  — the Prisma transaction client
 * @param {string} tenantId
 */
export async function assertLicenseAvailable(tx, tenantId) {
  const tenant = await tx.tenant.findUnique({
    where: { id: tenantId },
    select: { licenseLimit: true },
  });

  if (!tenant) {
    const err = new Error('Tenant not found');
    err.statusCode = 404;
    throw err;
  }

  const activeCount = await tx.tenantUser.count({
    where: {
      tenantId,
      isDeleted: false,
      status: { in: ['ACTIVE', 'INVITED'] },
    },
  });

  if (activeCount >= tenant.licenseLimit) {
    const err = new Error(
      `License capacity reached (${activeCount}/${tenant.licenseLimit}). ` +
      `Deactivate or exit an active employee before adding another.`
    );
    err.statusCode = 400;
    err.code = 'LICENSE_LIMIT_REACHED';
    err.details = {
      totalCapacity: tenant.licenseLimit,
      activeEmployees: activeCount,
      availableLicenses: 0,
    };
    throw err;
  }
}
