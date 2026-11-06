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

const INVITE_EXPIRES_HOURS = 72;

const createStaffSchema = z.object({
  name: z.string().trim().min(2, 'Name is required').max(120),
  email: z.string().trim().toLowerCase().email('A valid email address is required'),
});

const STAFF_SELECT = {
  id: true, name: true, email: true, role: true, status: true,
  isDeleted: true, lastLoginAt: true, createdAt: true,
};

/** Helper to query renewals and compute performance stats for an array of staff IDs */
async function getStaffRenewalStats(staffIds) {
  const statsMap = new Map();
  for (const sid of staffIds) {
    statsMap.set(sid, {
      renewalsCount: 0,
      renewedSeatsCount: 0,
      renewedRevenue: 0,
      lastRenewalAt: null,
      renewals: [],
    });
  }

  if (staffIds.length === 0) return statsMap;

  // 1. Direct renewals tagged with salesRepId
  const directSubs = await prisma.subscription.findMany({
    where: {
      salesRepId: { in: staffIds },
      renewedFromId: { not: null },
    },
    include: {
      tenant: { select: { id: true, companyName: true, domainName: true, tenantCode: true } },
      invoices: { select: { id: true, invoiceNumber: true, totalAmount: true, state: true, issuedAt: true } },
      renewedFrom: { select: { id: true, packageName: true, seatCount: true, endsAt: true } },
    },
    orderBy: { createdAt: 'desc' },
  });

  // 2. Audit logs where action = SUBSCRIPTION_RENEWED and actorId in staffIds
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
          invoices: { select: { id: true, invoiceNumber: true, totalAmount: true, state: true, issuedAt: true } },
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

/** GET /platform/staff — Sales/BD accounts enriched with renewal performance metrics. */
export async function listPlatformStaff(req, res, next) {
  try {
    const staffMembers = await prisma.tenantUser.findMany({
      where: { role: 'PLATFORM_SALES' },
      orderBy: { createdAt: 'desc' },
      select: STAFF_SELECT,
    });

    const staffIds = staffMembers.map((s) => s.id);
    const statsMap = await getStaffRenewalStats(staffIds);

    const items = staffMembers.map((s) => {
      const perf = statsMap.get(s.id) || { renewalsCount: 0, renewedSeatsCount: 0, renewedRevenue: 0, lastRenewalAt: null };
      return {
        ...s,
        renewalsCount: perf.renewalsCount,
        renewedSeatsCount: perf.renewedSeatsCount,
        renewedRevenue: perf.renewedRevenue,
        lastRenewalAt: perf.lastRenewalAt,
      };
    });

    res.json({ items });
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
    let topPerformer = null;

    const leaderboard = staffMembers.map((s) => {
      const perf = statsMap.get(s.id) || { renewalsCount: 0, renewedSeatsCount: 0, renewedRevenue: 0, lastRenewalAt: null };
      totalRenewals += perf.renewalsCount;
      totalSeats += perf.renewedSeatsCount;
      totalRevenue += perf.renewedRevenue;

      return {
        id: s.id,
        name: s.name,
        email: s.email,
        status: s.status,
        isDeleted: s.isDeleted,
        renewalsCount: perf.renewalsCount,
        renewedSeatsCount: perf.renewedSeatsCount,
        renewedRevenue: perf.renewedRevenue,
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
      lastRenewalAt: null,
      renewals: [],
    };

    res.json({
      staff,
      totals: {
        renewalsCount: staffStats.renewalsCount,
        renewedSeatsCount: staffStats.renewedSeatsCount,
        renewedRevenue: staffStats.renewedRevenue,
        lastRenewalAt: staffStats.lastRenewalAt,
      },
      renewals: staffStats.renewals,
    });
  } catch (err) {
    next(err);
  }
}

/** POST /platform/staff — create a Sales/BD user and email them a set-password link. */
export async function createPlatformStaff(req, res, next) {
  try {
    const parsed = createStaffSchema.safeParse(req.body || {});
    if (!parsed.success) {
      return res.status(400).json({ error: 'Validation failed', details: parsed.error.issues });
    }
    const { name, email } = parsed.data;

    const platformTenant = await prisma.tenant.findFirst({ where: { isPlatform: true }, select: { id: true, companyName: true } });
    if (!platformTenant) {
      return res.status(500).json({ error: 'Platform tenant is missing. Run the platform owner seed script first.' });
    }

    const existing = await prisma.tenantUser.findFirst({
      where: { email: { equals: email, mode: 'insensitive' } },
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
          name,
          email,
          passwordHash,
          role: 'PLATFORM_SALES',
          status: 'ACTIVE',
          mustChangePassword: false,
        },
        select: STAFF_SELECT,
      });
      await recordPlatformAction({
        tx,
        req,
        action: PLATFORM_ACTIONS.STAFF_CREATED,
        targetType: 'USER',
        targetId: user.id,
        afterValue: { email, role: 'PLATFORM_SALES' },
      });
      return user;
    });

    const { resetUrl } = await issuePasswordResetLink(staff.id, { expiresMinutes: INVITE_EXPIRES_HOURS * 60 });
    const { html, text } = renderInvitationEmail({
      setupUrl: resetUrl,
      expiresHours: INVITE_EXPIRES_HOURS,
      name,
      companyName: `${platformTenant.companyName} (Sales)`,
      email,
    });
    let inviteSent = true;
    try {
      await sendMail({ to: email, subject: 'You have been added as a UEIBI Sales user', html, text, event: 'PLATFORM_STAFF_INVITE' });
    } catch (mailErr) {
      inviteSent = false;
      console.error('[PLATFORM_STAFF] Invite email failed:', mailErr.message);
    }

    res.status(201).json({
      message: inviteSent
        ? `${name} has been added as a Sales user. A set-password link has been emailed to ${email}.`
        : `${name} has been added, but the invite email could not be sent. Use "Force reset" to send a new link.`,
      staff,
      inviteSent,
    });
  } catch (err) {
    next(err);
  }
}
