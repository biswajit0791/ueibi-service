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
import { emitToUser } from '../lib/socket.js';

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

/**
 * Asserts that the tenant has at least `requiredSlots` available license slots.
 * Designed for bulk import: validates the entire batch fits BEFORE creating any
 * rows. Must be called inside a Prisma interactive transaction.
 *
 * @param {import('@prisma/client').PrismaClient} tx  — the Prisma transaction client
 * @param {string} tenantId
 * @param {number} requiredSlots — number of new users to be created
 */
export async function assertBulkLicenseAvailable(tx, tenantId, requiredSlots) {
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

  const available = Math.max(0, tenant.licenseLimit - activeCount);

  if (requiredSlots > available) {
    const err = new Error(
      `Not enough license slots. Need ${requiredSlots} but only ${available} available ` +
      `(${activeCount}/${tenant.licenseLimit} used). ` +
      `Offboard existing employees or upgrade your license to continue.`
    );
    err.statusCode = 400;
    err.code = 'LICENSE_LIMIT_EXCEEDED';
    err.details = {
      totalCapacity: tenant.licenseLimit,
      activeEmployees: activeCount,
      availableLicenses: available,
      requiredSlots,
    };
    throw err;
  }
}

/**
 * Returns a list of active (non-deleted, ACTIVE or INVITED) employees for a
 * tenant that are eligible to be assigned as a reporting manager.
 * Used to populate the manager dropdown on the invite / bulk import form.
 *
 * @param {string} tenantId
 * @returns {Promise<Array<{ id: string, name: string, designation: string, department: string }>>}
 */
export async function listEligibleManagers(tenantId) {
  return prisma.tenantUser.findMany({
    where: {
      tenantId,
      isDeleted: false,
      status: { in: ['ACTIVE', 'INVITED'] },
    },
    select: {
      id: true,
      name: true,
      email: true,
      designation: true,
      department: true,
      role: true,
    },
    orderBy: { name: 'asc' },
  });
}

/**
 * Notify CEO/CMD, Finance, and HR users about licensing activities (requests, payments, approvals, rejections).
 */
export async function notifyLicensingActivity({
  tenantId,
  actor,
  action, // 'REQUESTED' | 'PURCHASED' | 'REJECTED'
  seats,
  totalAmount,
  paymentMethod,
  paymentRef,
  reason,
  requestId,
  newCapacity,
}) {
  try {
    const users = await prisma.tenantUser.findMany({
      where: {
        tenantId,
        isDeleted: false,
        status: { in: ['ACTIVE', 'INVITED'] },
      },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        department: true,
        designation: true,
        capabilities: { select: { capability: true } },
      },
    });

    const isCeo = (u) =>
      ['SUPER_ADMIN', 'CMD'].includes(u.role) ||
      u.capabilities?.some((c) => c.capability === 'LEADERSHIP') ||
      /(ceo|chief executive|cmd|director|founder|managing director)/i.test(u.designation || '');

    const isFinance = (u) =>
      u.role === 'FINANCE' ||
      /finance/i.test(u.department || '') ||
      /finance/i.test(u.designation || '');

    const isHr = (u) =>
      u.role === 'HR' ||
      /(hr|human resources?|people ops|talent)/i.test(u.department || '') ||
      /(hr|talent acquisition|people ops)/i.test(u.designation || '');

    const notifiedIds = new Set();
    const formattedAmount = totalAmount ? Number(totalAmount).toLocaleString('en-IN') : '0';

    for (const u of users) {
      let title = '';
      let body = '';

      if (action === 'REQUESTED') {
        // Finance and CEO are alerted when HR requests additional licenses
        if (isFinance(u) || isCeo(u)) {
          title = `New License Request from HR (+${seats} Seats)`;
          body = `${actor?.name || 'HR'} requested ${seats} employee licenses for "${reason || 'Onboarding'}". Total amount: ₹${formattedAmount}. Please review and process payment.`;
        }
      } else if (action === 'PURCHASED') {
        // CEO, Finance, and HR are all notified of completed payment and license purchase
        if (isCeo(u)) {
          title = `License Capacity Expanded (+${seats} Seats)`;
          body = `Finance (${actor?.name || 'Finance'}) completed payment of ₹${formattedAmount} for ${seats} employee licenses. Total capacity is now ${newCapacity} seats.`;
        } else if (isFinance(u)) {
          title = `License Payment Confirmed (+${seats} Seats)`;
          body = `Payment of ₹${formattedAmount} via ${paymentMethod || 'Online'} (Ref: ${paymentRef || 'N/A'}) was confirmed. ${seats} new license seats added.`;
        } else if (isHr(u)) {
          title = `Licenses Approved & Purchased (+${seats} Seats)`;
          body = `Finance has completed payment for ${seats} new employee licenses. Total capacity is now ${newCapacity}. You may now invite and onboard employees.`;
        }
      } else if (action === 'REJECTED') {
        if (isHr(u) || isCeo(u)) {
          title = `License Request Declined (${seats} Seats)`;
          body = `Finance declined the request for ${seats} employee licenses. Reason: ${reason || 'Not approved at this time.'}`;
        }
      }

      if (title && body && !notifiedIds.has(u.id)) {
        notifiedIds.add(u.id);
        const notif = await prisma.notification.create({
          data: {
            tenantId,
            recipientId: u.id,
            type: 'license_activity',
            title,
            body,
            entityType: 'license',
            entityId: requestId || null,
          },
        });
        emitToUser(tenantId, u.id, 'notification', notif);
      }
    }
  } catch (err) {
    console.error('[notifyLicensingActivity] Error notifying licensing activity:', err);
  }
}

