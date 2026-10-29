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
import { emitToUser, emitToTenant } from '../lib/socket.js';
import {
  calculateProRataLicensePrice,
  resolveLicenseTerm,
  resolveAnnualUnitPrice,
  round2,
} from './billing.service.js';

/**
 * Loads a tenant's current annual licence term and per-seat annual price.
 * Pass `client: tx` inside a transaction.
 *
 * @returns {Promise<{ startsAt: Date, endsAt: Date, remainingMonths: number, annualUnitPrice: number, subscription: object|null }>}
 */
export async function getLicenseTerm(tenantId, { client = prisma, now = new Date() } = {}) {
  const tenant = await client.tenant.findUnique({
    where: { id: tenantId },
    select: {
      createdAt: true,
      planEndsAt: true,
      // The term in force now — never a renewal queued to start later.
      subscriptions: {
        where: { state: { in: ['ACTIVE', 'PENDING'] }, startsAt: { lte: now } },
        orderBy: { startsAt: 'desc' },
        take: 1,
        select: {
          id: true, packageName: true, seatCount: true, state: true, startsAt: true, endsAt: true,
          package: { select: { unitPrice: true } },
          invoices: {
            where: { state: { not: 'VOID' } },
            orderBy: { createdAt: 'asc' },
            take: 1,
            select: { unitPrice: true },
          },
        },
      },
    },
  });
  const sub = tenant?.subscriptions?.[0] || null;
  const term = resolveLicenseTerm({
    subscriptionStartsAt: sub?.startsAt,
    subscriptionEndsAt: sub?.endsAt,
    planEndsAt: tenant?.planEndsAt,
    tenantCreatedAt: tenant?.createdAt,
  }, now);
  const annualUnitPrice = resolveAnnualUnitPrice({
    invoiceUnitPrice: sub?.invoices?.[0]?.unitPrice,
    packageUnitPrice: sub?.package?.unitPrice,
  });
  return { ...term, annualUnitPrice, subscription: sub };
}

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
 *   databaseIntegrity: number,
 *   billingCycle: string,
 *   planStartsAt: string | null,
 *   planEndsAt: string | null,
 *   renewalDate: string | null,
 *   daysRemaining: number | null,
 *   isExpiringSoon: boolean,
 *   isOverdue: boolean,
 *   subscriptionState: string,
 * }>}
 */
export async function getLicenseStats(tenantId) {
  const [tenant, activeEmployees, exEmployees, nonJoiners, verifiedWithPan] =
    await Promise.all([
      // 1. Tenant row (for licenseLimit, planEndsAt, and active subscription)
      prisma.tenant.findUnique({
        where: { id: tenantId },
        select: {
          id: true,
          licenseLimit: true,
          creditBalance: true,
          planEndsAt: true,
          createdAt: true,
          subscriptions: {
            where: { state: { in: ['ACTIVE', 'PENDING'] } },
            orderBy: { startsAt: 'desc' },
            take: 1,
            select: {
              id: true,
              packageName: true,
              seatCount: true,
              state: true,
              startsAt: true,
              endsAt: true,
            },
          },
        },
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

  // Annual Billing Cycle & Renewal calculation — shared with purchase, retraction and renewal.
  const now = new Date();
  const activeSub = tenant?.subscriptions?.[0] || null;
  const term = await getLicenseTerm(tenantId, { now });
  const planStartsAt = term.startsAt;
  const planEndsAt = term.endsAt;
  const daysRemaining = planEndsAt
    ? Math.ceil((new Date(planEndsAt).getTime() - now.getTime()) / 86400000)
    : null;

  const isExpiringSoon = daysRemaining !== null && daysRemaining <= 30 && daysRemaining >= 0;
  const isOverdue = daysRemaining !== null && daysRemaining < 0;

  const { remainingMonths, annualUnitPrice } = term;
  const proRataPricing = calculateProRataLicensePrice({
    annualUnitPrice,
    remainingMonths,
    seats: 1,
  });

  return {
    totalCapacity,
    activeEmployees,
    creditBalance: Number(tenant?.creditBalance || 0),
    unusedLicenses: availableLicenses,
    maxRetractableSeats: availableLicenses,
    retractionUnitCredit: proRataPricing.proRataUnitPrice,
    eligibleRetractionCredit: round2(availableLicenses * proRataPricing.proRataUnitPrice),
    availableLicenses,
    exEmployees,
    nonJoiners,
    databaseIntegrity,
    // Annual Billing Cycle & Renewal info
    billingCycle: 'Annual',
    annualUnitPrice,
    proRataUnitPrice: proRataPricing.proRataUnitPrice,
    remainingMonths,
    planStartsAt: planStartsAt ? new Date(planStartsAt).toISOString() : null,
    planEndsAt: planEndsAt ? new Date(planEndsAt).toISOString() : null,
    renewalDate: planEndsAt ? new Date(planEndsAt).toISOString() : null,
    daysRemaining,
    isExpiringSoon,
    isOverdue,
    subscriptionState: activeSub?.state || (isOverdue ? 'EXPIRED' : 'ACTIVE'),
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
      } else if (action === 'RETRACTED') {
        if (isCeo(u)) {
          title = `License Retraction Processed (-${seats} Seats)`;
          body = `Finance (${actor?.name || 'Finance'}) retracted ${seats} unused license(s). ₹${formattedAmount} converted to Company Wallet Credit for renewal. Capacity is now ${newCapacity} seats.`;
        } else if (isFinance(u)) {
          title = `Unused Licenses Retracted & Credited (-${seats} Seats)`;
          body = `Successfully retracted ${seats} unused license(s). Converted to ₹${formattedAmount} wallet credit balance redeemable against upcoming renewal.`;
        } else if (isHr(u)) {
          title = `License Capacity Adjusted (-${seats} Seats)`;
          body = `Company license capacity was reduced by ${seats} unused seat(s). New seat capacity is ${newCapacity}.`;
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

/**
 * Automatically notify HR and Finance when available license slots drop below 10% or 2 seats remaining,
 * allowing proactive procurement before onboarding hits a hard block.
 */
export async function checkAndNotifyLowLicenseCapacity(tenantId) {
  try {
    if (!tenantId) return;
    const stats = await getLicenseStats(tenantId);
    const { totalCapacity, availableLicenses } = stats;

    if (totalCapacity <= 0) return;

    const percentRemaining = (availableLicenses / totalCapacity) * 100;
    const isBelowThreshold = availableLicenses <= 2 || percentRemaining <= 10;

    if (!isBelowThreshold) return;

    // Deduplicate / Throttle: avoid spamming if an alert was already dispatched recently with the same or fewer available seats
    const recentAlert = await prisma.notification.findFirst({
      where: {
        tenantId,
        type: 'license_low_capacity',
        createdAt: { gte: new Date(Date.now() - 12 * 60 * 60 * 1000) },
      },
      orderBy: { createdAt: 'desc' },
    });

    if (recentAlert && recentAlert.body && recentAlert.body.includes(`${availableLicenses} of ${totalCapacity}`)) {
      return;
    }

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

    const isFinance = (u) =>
      u.role === 'FINANCE' ||
      /finance/i.test(u.department || '') ||
      /finance/i.test(u.designation || '');

    const isHr = (u) =>
      u.role === 'HR' ||
      /(hr|human resources?|people ops|talent)/i.test(u.department || '') ||
      /(hr|talent acquisition|people ops)/i.test(u.designation || '');

    const isCeo = (u) =>
      ['SUPER_ADMIN', 'CMD'].includes(u.role) ||
      u.capabilities?.some((c) => c.capability === 'LEADERSHIP') ||
      /(ceo|chief executive|cmd|director|founder|managing director)/i.test(u.designation || '');

    const roundedPercent = Math.round(percentRemaining);
    const notifiedIds = new Set();

    for (const u of users) {
      if (!isFinance(u) && !isHr(u) && !isCeo(u)) continue;
      if (notifiedIds.has(u.id)) continue;
      notifiedIds.add(u.id);

      let title = `⚠️ Low License Capacity (${availableLicenses} Remaining)`;
      let body = '';

      if (isHr(u)) {
        body = `Only ${availableLicenses} of ${totalCapacity} license slots (${roundedPercent}%) remain available. Please submit a license expansion request to Finance to prevent onboarding delays.`;
      } else {
        // Finance and Leadership
        body = `Only ${availableLicenses} of ${totalCapacity} license slots (${roundedPercent}%) remain available. Please review license capacity and purchase additional seats.`;
      }

      const notif = await prisma.notification.create({
        data: {
          tenantId,
          recipientId: u.id,
          type: 'license_low_capacity',
          title,
          body,
          entityType: 'license',
          entityId: null,
        },
      });

      emitToUser(tenantId, u.id, 'notification', notif);
    }

    emitToTenant(tenantId, 'LOW_LICENSE_CAPACITY', {
      availableLicenses,
      totalCapacity,
      percentRemaining: roundedPercent,
    });
  } catch (err) {
    console.error('[checkAndNotifyLowLicenseCapacity] Error checking low license capacity:', err);
  }
}




/**
 * Calculates a detailed quote for retracting unused licenses and converting them into wallet credit.
 *
 * @param {string} tenantId
 * @returns {Promise<{
 *   totalCapacity: number,
 *   activeEmployees: number,
 *   unusedLicenses: number,
 *   maxRetractableSeats: number,
 *   annualUnitPrice: number,
 *   remainingMonths: number,
 *   unitCreditValue: number,
 *   maxCreditValue: number,
 *   currentWalletBalance: number,
 *   renewalDate: string | null,
 *   daysRemaining: number | null,
 *   isExpiringSoon: boolean,
 * }>}
 */
export async function calculateLicenseRetractionQuote(tenantId) {
  const stats = await getLicenseStats(tenantId);
  const {
    totalCapacity,
    activeEmployees,
    availableLicenses,
    annualUnitPrice,
    remainingMonths,
    proRataUnitPrice,
    renewalDate,
    daysRemaining,
    isExpiringSoon,
    creditBalance,
  } = stats;

  const unusedLicenses = availableLicenses;
  const unitCreditValue = proRataUnitPrice;
  const maxCreditValue = round2(unusedLicenses * unitCreditValue);

  return {
    totalCapacity,
    activeEmployees,
    unusedLicenses,
    maxRetractableSeats: unusedLicenses,
    annualUnitPrice,
    remainingMonths,
    unitCreditValue,
    maxCreditValue,
    currentWalletBalance: creditBalance,
    renewalDate,
    daysRemaining,
    isExpiringSoon,
  };
}

/**
 * Retracts unused license seats from a tenant, reducing licenseLimit and converting the
 * eligible prorated value of those seats into a wallet credit balance redeemable against renewal.
 *
 * @param {Object} params
 * @param {string} params.tenantId
 * @param {number} params.seatsToRetract
 * @param {Object} params.actor - Authenticated user performing retraction
 * @param {string} [params.reason]
 */
export async function retractUnusedLicenses({ tenantId, seatsToRetract, actor, reason }) {
  const seats = parseInt(seatsToRetract, 10);
  if (!seats || isNaN(seats) || seats <= 0) {
    const err = new Error('Please specify a positive integer of licenses to retract.');
    err.statusCode = 400;
    throw err;
  }

  const now = new Date();

  // Interactive transaction ensuring atomicity and avoiding race conditions
  const txResult = await prisma.$transaction(async (tx) => {
    const tenant = await tx.tenant.findUnique({
      where: { id: tenantId },
      select: {
        id: true,
        companyName: true,
        licenseLimit: true,
        creditBalance: true,
        planEndsAt: true,
        createdAt: true,
        subscriptions: {
          where: { state: { in: ['ACTIVE', 'PENDING'] } },
          orderBy: { startsAt: 'desc' },
          take: 1,
        },
      },
    });

    if (!tenant) {
      const err = new Error('Tenant not found.');
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

    const totalCapacity = tenant.licenseLimit ?? 0;
    const availableUnused = Math.max(0, totalCapacity - activeCount);

    if (seats > availableUnused) {
      const err = new Error(
        `Cannot retract ${seats} license(s). Only ${availableUnused} unused license(s) available. Active employees (${activeCount} seats) cannot have their licenses retracted.`
      );
      err.statusCode = 400;
      err.code = 'EXCEEDS_UNUSED_CAPACITY';
      err.details = {
        totalCapacity,
        activeEmployees: activeCount,
        availableUnused,
        requestedRetraction: seats,
      };
      throw err;
    }

    // Months already used are consumed; the remaining months of the annual term are credited
    // at the price the company paid. E.g. bought in January, returned in May → May–Dec (8/12) back.
    const activeSub = tenant.subscriptions?.[0] || null;
    const { remainingMonths, annualUnitPrice } = await getLicenseTerm(tenantId, { client: tx, now });
    const unitCredit = round2((annualUnitPrice * remainingMonths) / 12);
    const totalCreditAmount = round2(seats * unitCredit);

    const newLimit = totalCapacity - seats;
    const currentBalance = Number(tenant.creditBalance || 0);
    const newCreditBalance = round2(currentBalance + totalCreditAmount);

    // Update tenant license limit & credit balance
    await tx.tenant.update({
      where: { id: tenantId },
      data: {
        licenseLimit: newLimit,
        creditBalance: newCreditBalance,
      },
    });

    // Update active subscription seat capacity
    if (activeSub) {
      await tx.subscription.update({
        where: { id: activeSub.id },
        data: {
          seatCount: newLimit,
          packageName: `${newLimit} Licenses (Annual)`,
        },
      });
    }

    // Record wallet ledger transaction
    const walletTx = await tx.walletTransaction.create({
      data: {
        tenantId,
        type: 'RETRACTION_CREDIT',
        amount: totalCreditAmount,
        balanceAfter: newCreditBalance,
        seatsRetracted: seats,
        unitCredit,
        remainingMonths,
        description: reason?.trim() || `Retracted ${seats} unused license(s) @ ₹${unitCredit}/seat (${remainingMonths}/12 mo pro-rata). Converted to wallet credit balance for renewal.`,
        createdById: actor?.id || null,
      },
    });

    return {
      newLimit,
      totalCreditAmount,
      newCreditBalance,
      seatsRetracted: seats,
      unitCredit,
      remainingMonths,
      walletTx,
    };
  });

  // Post-transaction notifications and events
  await notifyLicensingActivity({
    tenantId,
    actor,
    action: 'RETRACTED',
    seats: txResult.seatsRetracted,
    totalAmount: txResult.totalCreditAmount,
    reason,
    newCapacity: txResult.newLimit,
  });

  const stats = await getLicenseStats(tenantId);

  emitToTenant(tenantId, 'LICENSE_CAPACITY_UPDATED', {
    licenseStats: stats,
    message: `Tenant license capacity retracted by ${seats} unused seat(s). ₹${txResult.totalCreditAmount} converted to wallet credit.`,
  });

  emitToTenant(tenantId, 'WALLET_BALANCE_UPDATED', {
    creditBalance: txResult.newCreditBalance,
    transaction: txResult.walletTx,
  });

  return {
    success: true,
    message: `Successfully retracted ${seats} unused license seat(s). ₹${txResult.totalCreditAmount.toLocaleString('en-IN')} has been credited to your company wallet balance and is redeemable against your next renewal.`,
    retractedSeats: seats,
    creditAmount: txResult.totalCreditAmount,
    newCapacity: txResult.newLimit,
    walletBalance: txResult.newCreditBalance,
    licenseStats: stats,
    transaction: txResult.walletTx,
  };
}

/**
 * Returns complete tenant wallet summary: current balance, recent ledger transactions, and retraction eligibility.
 *
 * @param {string} tenantId
 */
export async function getTenantWalletSummary(tenantId) {
  const [tenant, transactions, stats] = await Promise.all([
    prisma.tenant.findUnique({
      where: { id: tenantId },
      select: {
        id: true,
        companyName: true,
        creditBalance: true,
        licenseLimit: true,
        planEndsAt: true,
      },
    }),
    prisma.walletTransaction.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
      take: 50,
      include: {
        createdBy: {
          select: { id: true, name: true, email: true, role: true },
        },
      },
    }),
    getLicenseStats(tenantId),
  ]);

  if (!tenant) {
    const err = new Error('Tenant not found');
    err.statusCode = 404;
    throw err;
  }

  const quote = await calculateLicenseRetractionQuote(tenantId);

  return {
    creditBalance: Number(tenant.creditBalance || 0),
    transactions,
    licenseStats: stats,
    retractionQuote: quote,
  };
}
