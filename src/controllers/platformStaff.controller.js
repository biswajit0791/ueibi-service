/**
 * Platform staff (Sales / Business Development) accounts & performance tracking.
 *
 * Only the platform owner manages these, and only PLATFORM_SALES can be
 * created here — PLATFORM_OWNER still comes into existence solely through
 * scripts/seed-platform-owner.js. Staff live in the internal platform tenant
 * and set their first password through a one-time link.
 * Deactivate / reactivate use the existing /platform/users/:id/* actions.
 */
import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { sendMail } from '../lib/mailer.js';
import { renderInvitationEmail } from '../lib/emailTemplates.js';
import { issuePasswordResetLink } from '../services/passwordReset.service.js';
import { recordPlatformAction, PLATFORM_ACTIONS } from '../services/platformAudit.service.js';
import {
  PLATFORM_MENUS,
  ALL_MENU_KEYS,
  getUserPlatformPermissions,
  updateUserPlatformPermissions,
  initializeDefaultPlatformPermissions,
} from '../services/platformPermissions.service.js';

const INVITE_EXPIRES_HOURS = 72;

const createStaffSchema = z.object({
  name: z.string().trim().min(2, 'Name is required').max(120),
  email: z.string().trim().toLowerCase().email('A valid personal email address is required'),
  designation: z.string().trim().max(120).optional(),
});

const STAFF_SELECT = {
  id: true,
  name: true,
  email: true,
  personalEmail: true,
  role: true,
  designation: true,
  status: true,
  isDeleted: true,
  lastLoginAt: true,
  createdAt: true,
};

/** Helper to query renewals and compute performance stats for an array of staff IDs */
async function getStaffRenewalStats(staffIds) {
  const statsMap = new Map();
  for (const sid of staffIds) {
    statsMap.set(sid, {
      renewalsCount: 0,
      renewedSeatsCount: 0,
      renewedRevenue: 0,
      totalCouponsAssigned: 0,
      totalCouponUsage: 0,
      totalDiscountsProvided: 0,
      lastRenewalAt: null,
      coupons: [],
      renewals: [],
    });
  }

  if (staffIds.length === 0) return statsMap;

  // 1. Coupons assigned to these staff members
  const assignedCoupons = await prisma.coupon.findMany({
    where: { salesRepId: { in: staffIds } },
    select: {
      id: true,
      code: true,
      discountType: true,
      discountValue: true,
      salesRepId: true,
      timesUsed: true,
      usageLimit: true,
      active: true,
      expiresAt: true,
      createdAt: true,
    },
    orderBy: { createdAt: 'desc' },
  });

  for (const c of assignedCoupons) {
    if (c.salesRepId && statsMap.has(c.salesRepId)) {
      const entry = statsMap.get(c.salesRepId);
      entry.totalCouponsAssigned += 1;
      entry.totalCouponUsage += (c.timesUsed || 0);
      entry.coupons.push(c);
    }
  }

  // 2. Coupon redemptions for coupons assigned to these staff members
  const redemptions = await prisma.couponRedemption.findMany({
    where: { coupon: { salesRepId: { in: staffIds } } },
    select: {
      discountAmount: true,
      coupon: { select: { salesRepId: true } },
    },
  });

  for (const r of redemptions) {
    const sId = r.coupon?.salesRepId;
    if (sId && statsMap.has(sId)) {
      statsMap.get(sId).totalDiscountsProvided += Number(r.discountAmount || 0);
    }
  }

  // 3. Direct renewals tagged with salesRepId
  const directSubs = await prisma.subscription.findMany({
    where: {
      salesRepId: { in: staffIds },
      renewedFromId: { not: null },
    },
    include: {
      tenant: { select: { id: true, companyName: true, domainName: true, tenantCode: true } },
      invoices: { select: { id: true, invoiceNumber: true, totalAmount: true, discountAmount: true, state: true, issuedAt: true } },
      renewedFrom: { select: { id: true, packageName: true, seatCount: true, endsAt: true } },
    },
    orderBy: { createdAt: 'desc' },
  });

  // 4. Audit logs where action = SUBSCRIPTION_RENEWED and actorId in staffIds
  const auditLogs = await prisma.platformAuditLog.findMany({
    where: {
      action: 'SUBSCRIPTION_RENEWED',
      actorId: { in: staffIds },
    },
    orderBy: { createdAt: 'desc' },
  });

  const loggedSubIds = auditLogs.map((l) => l.targetId).filter(Boolean);
  const directSubIdSet = new Set(directSubs.map((s) => s.id));
  const fallbackSubIds = loggedSubIds.filter((id) => !directSubIdSet.has(id));

  const fallbackSubs = fallbackSubIds.length > 0
    ? await prisma.subscription.findMany({
        where: {
          id: { in: fallbackSubIds },
          renewedFromId: { not: null },
        },
        include: {
          tenant: { select: { id: true, companyName: true, domainName: true, tenantCode: true } },
          invoices: { select: { id: true, invoiceNumber: true, totalAmount: true, discountAmount: true, state: true, issuedAt: true } },
          renewedFrom: { select: { id: true, packageName: true, seatCount: true, endsAt: true } },
        },
      })
    : [];

  const subActorMap = new Map();
  for (const log of auditLogs) {
    if (log.targetId && !subActorMap.has(log.targetId)) {
      subActorMap.set(log.targetId, log.actorId);
    }
  }

  const allRenewals = [
    ...directSubs.map((s) => ({ ...s, assignedStaffId: s.salesRepId })),
    ...fallbackSubs
      .map((s) => ({ ...s, assignedStaffId: subActorMap.get(s.id) }))
      .filter((s) => s.assignedStaffId && statsMap.has(s.assignedStaffId)),
  ];

  for (const sub of allRenewals) {
    const entry = statsMap.get(sub.assignedStaffId);
    if (!entry) continue;

    entry.renewalsCount += 1;
    entry.renewedSeatsCount += (sub.seatCount || 0);

    const invTotal = (sub.invoices || []).reduce((sum, inv) => sum + Number(inv.totalAmount || 0), 0);
    entry.renewedRevenue += invTotal;

    const invDiscount = (sub.invoices || []).reduce((sum, inv) => sum + Number(inv.discountAmount || 0), 0);
    if (invDiscount > 0 && entry.totalDiscountsProvided === 0) {
      entry.totalDiscountsProvided += invDiscount;
    }

    if (!entry.lastRenewalAt || new Date(sub.createdAt) > new Date(entry.lastRenewalAt)) {
      entry.lastRenewalAt = sub.createdAt;
    }

    entry.renewals.push({
      id: sub.id,
      packageName: sub.packageName,
      seatCount: sub.seatCount,
      state: sub.state,
      startsAt: sub.startsAt,
      endsAt: sub.endsAt,
      createdAt: sub.createdAt,
      tenant: sub.tenant,
      invoices: sub.invoices,
      renewedFrom: sub.renewedFrom,
    });
  }

  return statsMap;
}

/** GET /platform/staff — Internal Team accounts enriched with menu permissions and renewal metrics. */
export async function listPlatformStaff(req, res, next) {
  try {
    const staffMembers = await prisma.tenantUser.findMany({
      where: { role: 'PLATFORM_SALES' },
      orderBy: { createdAt: 'desc' },
      select: STAFF_SELECT,
    });

    const totalUsers = staffMembers.filter((s) => !s.isDeleted).length;
    const activeUsers = staffMembers.filter((s) => s.status === 'ACTIVE' && !s.isDeleted).length;
    const suspendedAccounts = staffMembers.filter((s) => (s.status === 'SUSPENDED' || s.status === 'INACTIVE') || s.isDeleted).length;

    const staffIds = staffMembers.map((s) => s.id);
    const statsMap = await getStaffRenewalStats(staffIds);

    const items = await Promise.all(
      staffMembers.map(async (s) => {
        const perf = statsMap.get(s.id) || {
          renewalsCount: 0,
          renewedSeatsCount: 0,
          renewedRevenue: 0,
          totalCouponsAssigned: 0,
          totalCouponUsage: 0,
          totalDiscountsProvided: 0,
          lastRenewalAt: null,
        };
        const permissions = await getUserPlatformPermissions(s.id, s.role);
        return {
          ...s,
          personalEmail: s.personalEmail || s.email,
          designation: s.designation || 'Internal Team Member',
          permissions,
          renewalsCount: perf.renewalsCount,
          renewedSeatsCount: perf.renewedSeatsCount,
          renewedRevenue: perf.renewedRevenue,
          totalCouponsAssigned: perf.totalCouponsAssigned,
          totalCouponUsage: perf.totalCouponUsage,
          totalDiscountsProvided: perf.totalDiscountsProvided,
          lastRenewalAt: perf.lastRenewalAt,
        };
      })
    );

    res.json({
      items,
      summary: {
        totalUsers,
        activeUsers,
        suspendedAccounts,
      },
    });
  } catch (err) {
    next(err);
  }
}

/** GET /platform/staff/performance — High-level KPI summary and performance leaderboard */
export async function getSalesPerformanceSummary(req, res, next) {
  try {
    const staffMembers = await prisma.tenantUser.findMany({
      where: { role: 'PLATFORM_SALES' },
      select: STAFF_SELECT,
    });

    const staffIds = staffMembers.map((s) => s.id);
    const statsMap = await getStaffRenewalStats(staffIds);

    let totalRenewals = 0;
    let totalSeats = 0;
    let totalRevenue = 0;
    let totalDiscounts = 0;
    let totalCoupons = 0;
    let topPerformer = null;

    const leaderboard = staffMembers.map((s) => {
      const perf = statsMap.get(s.id) || {
        renewalsCount: 0,
        renewedSeatsCount: 0,
        renewedRevenue: 0,
        totalCouponsAssigned: 0,
        totalCouponUsage: 0,
        totalDiscountsProvided: 0,
        lastRenewalAt: null,
      };
      totalRenewals += perf.renewalsCount;
      totalSeats += perf.renewedSeatsCount;
      totalRevenue += perf.renewedRevenue;
      totalDiscounts += perf.totalDiscountsProvided;
      totalCoupons += perf.totalCouponsAssigned;

      return {
        id: s.id,
        name: s.name,
        email: s.email,
        designation: s.designation,
        status: s.status,
        isDeleted: s.isDeleted,
        renewalsCount: perf.renewalsCount,
        renewedSeatsCount: perf.renewedSeatsCount,
        renewedRevenue: perf.renewedRevenue,
        totalCouponsAssigned: perf.totalCouponsAssigned,
        totalCouponUsage: perf.totalCouponUsage,
        totalDiscountsProvided: perf.totalDiscountsProvided,
        lastRenewalAt: perf.lastRenewalAt,
      };
    });

    leaderboard.sort((a, b) => {
      if (b.renewalsCount !== a.renewalsCount) return b.renewalsCount - a.renewalsCount;
      return b.renewedRevenue - a.renewedRevenue;
    });

    if (leaderboard.length > 0 && leaderboard[0].renewalsCount > 0) {
      topPerformer = leaderboard[0];
    }

    res.json({
      summary: {
        totalStaff: staffMembers.length,
        activeStaff: staffMembers.filter((s) => s.status === 'ACTIVE' && !s.isDeleted).length,
        totalRenewals,
        totalSeats,
        totalRevenue,
        totalDiscounts,
        totalCoupons,
        topPerformer,
      },
      leaderboard,
    });
  } catch (err) {
    next(err);
  }
}

/** GET /platform/staff/:id/renewals — Detailed ledger of all renewals completed by a specific staff member */
export async function getStaffRenewalHistory(req, res, next) {
  try {
    const { id } = req.params;
    const staff = await prisma.tenantUser.findFirst({
      where: { id, role: 'PLATFORM_SALES' },
      select: STAFF_SELECT,
    });

    if (!staff) {
      return res.status(404).json({ error: 'Sales team member not found' });
    }

    const statsMap = await getStaffRenewalStats([id]);
    const staffStats = statsMap.get(id) || {
      renewalsCount: 0,
      renewedSeatsCount: 0,
      renewedRevenue: 0,
      totalCouponsAssigned: 0,
      totalCouponUsage: 0,
      totalDiscountsProvided: 0,
      lastRenewalAt: null,
      coupons: [],
      renewals: [],
    };

    res.json({
      staff,
      totals: {
        renewalsCount: staffStats.renewalsCount,
        renewedSeatsCount: staffStats.renewedSeatsCount,
        renewedRevenue: staffStats.renewedRevenue,
        totalCouponsAssigned: staffStats.totalCouponsAssigned,
        totalCouponUsage: staffStats.totalCouponUsage,
        totalDiscountsProvided: staffStats.totalDiscountsProvided,
        lastRenewalAt: staffStats.lastRenewalAt,
      },
      coupons: staffStats.coupons,
      renewals: staffStats.renewals,
    });
  } catch (err) {
    next(err);
  }
}

/** POST /platform/staff — create an Internal Team user and email them a set-password link. */
export async function createPlatformStaff(req, res, next) {
  try {
    const parsed = createStaffSchema.safeParse(req.body || {});
    if (!parsed.success) {
      return res.status(400).json({ error: 'Validation failed', details: parsed.error.issues });
    }
    const { name, email, designation } = parsed.data;
    const normalizedEmail = email.trim().toLowerCase();

    const platformTenant = await prisma.tenant.findFirst({ where: { isPlatform: true }, select: { id: true, companyName: true } });
    if (!platformTenant) {
      return res.status(500).json({ error: 'Platform tenant is missing. Run the platform owner seed script first.' });
    }

    const existing = await prisma.tenantUser.findFirst({
      where: {
        OR: [
          { email: { equals: normalizedEmail, mode: 'insensitive' } },
          { personalEmail: { equals: normalizedEmail, mode: 'insensitive' } },
        ],
      },
      select: { id: true },
    });
    if (existing) {
      return res.status(409).json({ error: 'A user with this email already exists.', code: 'EMAIL_EXISTS' });
    }

    // Unusable random password; the person sets their own through the link.
    const passwordHash = await bcrypt.hash(crypto.randomBytes(32).toString('hex'), 10);

    const staff = await prisma.$transaction(async (tx) => {
      const user = await tx.tenantUser.create({
        data: {
          tenantId: platformTenant.id,
          name: name.trim(),
          email: normalizedEmail,
          personalEmail: normalizedEmail,
          passwordHash,
          role: 'PLATFORM_SALES',
          designation: designation?.trim() || 'Internal Team Member',
          status: 'ACTIVE',
          mustChangePassword: false,
        },
        select: STAFF_SELECT,
      });
      await recordPlatformAction({
        tx,
        req,
        action: PLATFORM_ACTIONS.STAFF_CREATED || 'STAFF_CREATED',
        targetType: 'USER',
        targetId: user.id,
        afterValue: { email: normalizedEmail, role: 'PLATFORM_SALES' },
      });
      return user;
    });

    // Initialize default menu permissions for the new internal staff member
    await initializeDefaultPlatformPermissions(staff.id);

    const { resetUrl } = await issuePasswordResetLink(staff.id, { expiresMinutes: INVITE_EXPIRES_HOURS * 60 });
    const { html, text } = renderInvitationEmail({
      setupUrl: resetUrl,
      expiresHours: INVITE_EXPIRES_HOURS,
      name,
      companyName: `${platformTenant.companyName} (Internal Team)`,
      email: normalizedEmail,
    });
    let inviteSent = true;
    try {
      await sendMail({
        to: normalizedEmail,
        subject: 'You have been added to the Karyam Internal Team',
        html,
        text,
        event: 'PLATFORM_STAFF_INVITE',
      });
    } catch (mailErr) {
      inviteSent = false;
      console.error('[PLATFORM_STAFF] Invite email failed:', mailErr.message);
    }

    res.status(201).json({
      message: inviteSent
        ? `${name} has been added to the Internal Team. A set-password link has been emailed to ${normalizedEmail}.`
        : `${name} has been added to the Internal Team, but the invite email could not be sent. Use "Force reset" to send a new link.`,
      staff,
      inviteSent,
    });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /platform/staff/:id/permissions — Fetch an internal staff member's menu permissions.
 * Platform Owner only.
 */
export async function getStaffPermissions(req, res, next) {
  try {
    const { id } = req.params;
    const staff = await prisma.tenantUser.findFirst({
      where: { id, role: 'PLATFORM_SALES' },
      select: { id: true, name: true, email: true, personalEmail: true, designation: true, role: true },
    });

    if (!staff) {
      return res.status(404).json({ error: 'Internal team member not found' });
    }

    const permissions = await getUserPlatformPermissions(id, staff.role);

    res.json({
      user: {
        ...staff,
        personalEmail: staff.personalEmail || staff.email,
        designation: staff.designation || 'Internal Team Member',
      },
      permissions,
      menus: PLATFORM_MENUS,
    });
  } catch (err) {
    next(err);
  }
}

/**
 * PUT /platform/staff/:id/permissions — Update an internal staff member's menu permissions.
 * Platform Owner only.
 */
export async function updateStaffPermissions(req, res, next) {
  try {
    const { id } = req.params;
    const permissions = req.body?.permissions;
    if (!permissions || typeof permissions !== 'object') {
      return res.status(400).json({ error: 'permissions object is required' });
    }

    const updatedPermissions = await updateUserPlatformPermissions(id, permissions);

    await recordPlatformAction({
      req,
      action: 'PLATFORM_STAFF_PERMISSIONS_UPDATED',
      targetType: 'USER',
      targetId: id,
      afterValue: { permissions: updatedPermissions },
    });

    res.json({
      message: 'Individual menu permissions updated successfully.',
      permissions: updatedPermissions,
    });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /platform/my-permissions — Fetch current logged-in platform user's effective permissions.
 */
export async function getMyPlatformPermissions(req, res, next) {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    const permissions = await getUserPlatformPermissions(req.user.id, req.user.role);
    res.json({
      isOwner: String(req.user.role || '').toUpperCase() === 'PLATFORM_OWNER',
      permissions,
      menus: PLATFORM_MENUS,
    });
  } catch (err) {
    next(err);
  }
}


const updateStaffSchema = z.object({
  name: z.string().trim().min(2, 'Name is required').max(120).optional(),
  email: z.string().trim().toLowerCase().email('A valid email address is required').optional(),
  status: z.enum(['ACTIVE', 'INACTIVE', 'SUSPENDED']).optional(),
  password: z.string().min(6, 'Password must be at least 6 characters').max(100).optional(),
  mustChangePassword: z.boolean().optional(),
});

/** PATCH /platform/staff/:id — Dynamically update Sales Team member name, Login ID (email), status, or password */
export async function updatePlatformStaff(req, res, next) {
  try {
    const { id } = req.params;
    const staff = await prisma.tenantUser.findFirst({
      where: { id, role: 'PLATFORM_SALES' },
    });
    if (!staff) {
      return res.status(404).json({ error: 'Sales team member not found' });
    }

    const parsed = updateStaffSchema.safeParse(req.body || {});
    if (!parsed.success) {
      return res.status(400).json({ error: 'Validation failed', details: parsed.error.issues });
    }

    const { name, email, status, password, mustChangePassword } = parsed.data;
    const updateData = {};

    if (name) updateData.name = name;
    if (status) updateData.status = status;
    if (typeof mustChangePassword === 'boolean') updateData.mustChangePassword = mustChangePassword;

    if (email && email.toLowerCase() !== staff.email.toLowerCase()) {
      const emailConflict = await prisma.tenantUser.findFirst({
        where: {
          id: { not: id },
          email: { equals: email, mode: 'insensitive' },
        },
        select: { id: true },
      });
      if (emailConflict) {
        return res.status(409).json({ error: 'This Login ID / email is already used by another user.', code: 'EMAIL_EXISTS' });
      }
      updateData.email = email;
    }

    if (password) {
      updateData.passwordHash = await bcrypt.hash(password, 10);
    }

    const updated = await prisma.$transaction(async (tx) => {
      const user = await tx.tenantUser.update({
        where: { id },
        data: updateData,
        select: STAFF_SELECT,
      });

      await recordPlatformAction({
        tx,
        req,
        action: PLATFORM_ACTIONS.STAFF_UPDATED || 'STAFF_UPDATED',
        targetType: 'USER',
        targetId: user.id,
        beforeValue: { name: staff.name, email: staff.email, status: staff.status },
        afterValue: { name: user.name, email: user.email, status: user.status, passwordChanged: !!password },
      });

      return user;
    });

    res.json({
      message: 'Sales team member credentials and profile updated successfully.',
      staff: updated,
    });
  } catch (err) {
    next(err);
  }
}

/** POST /platform/staff/:id/direct-reset — Generate an immediate one-click temporary password for Sales Team */
export async function directResetStaffPassword(req, res, next) {
  try {
    const { id } = req.params;
    const staff = await prisma.tenantUser.findFirst({
      where: { id, role: 'PLATFORM_SALES' },
      select: STAFF_SELECT,
    });
    if (!staff) {
      return res.status(404).json({ error: 'Sales team member not found' });
    }

    const tempPassword = req.body?.customPassword?.trim() || ('Sales#' + crypto.randomBytes(4).toString('hex').toUpperCase());
    const passwordHash = await bcrypt.hash(tempPassword, 10);

    await prisma.$transaction(async (tx) => {
      await tx.tenantUser.update({
        where: { id },
        data: {
          passwordHash,
          mustChangePassword: true,
          status: 'ACTIVE',
        },
      });

      await recordPlatformAction({
        tx,
        req,
        action: PLATFORM_ACTIONS.STAFF_PASSWORD_RESET || 'STAFF_PASSWORD_RESET',
        targetType: 'USER',
        targetId: id,
        afterValue: { email: staff.email, resetType: 'DIRECT_TEMP_PASSWORD' },
      });
    });

    res.json({
      message: 'Temporary password set successfully. Share these credentials with the team member.',
      email: staff.email,
      temporaryPassword: tempPassword,
      mustChangePassword: true,
    });
  } catch (err) {
    next(err);
  }
}
