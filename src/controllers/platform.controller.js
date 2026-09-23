/**
 * platform.controller.js
 *
 * Read-only operator view of the platform itself: how many companies exist,
 * how many seats they use, what is waiting to be onboarded.
 *
 * These are the ONLY handlers in the codebase that intentionally read across
 * tenants, so two rules apply and are enforced by the route wiring:
 *
 *   1. Every route is behind requireAuth + requirePlatformOwner. No company
 *      role reaches them, however elevated it is inside its own tenant.
 *   2. They return company metadata and COUNTS only — never a goal, employee
 *      record, message, dispute or any other tenant-owned row. Aggregates keep
 *      the operator informed without handing them customer data.
 */
import crypto from 'node:crypto';
import { prisma } from '../lib/prisma.js';
import { env } from '../config/env.js';
import { generateRawToken, hashToken } from '../lib/tokens.js';
import { sendMail } from '../lib/mailer.js';
import { renderPasswordResetEmail, renderEmailWrapper } from '../lib/emailTemplates.js';
import {
  platformTenantQuerySchema,
  tenantIdParamSchema,
  suspendTenantSchema,
  platformAuditQuerySchema,
  tenantLifecycleSchema,
  tenantLicenceSchema,
  platformUserIdParamSchema,
  platformUserQuerySchema,
  platformUserActionSchema,
  registrationIdParamSchema,
  onboardingQuerySchema,
  registrationVerifySchema,
} from '../validations/platform.schema.js';
import {
  recordPlatformAction,
  listPlatformAudit,
  PLATFORM_ACTIONS,
} from '../services/platformAudit.service.js';

/** Tenants that belong to customers — the internal platform tenant is not a company. */
const CUSTOMER_TENANTS = { isPlatform: false };

/** Every commercial state a company can be in, so a breakdown never omits one. */
const TENANT_STATES = ['ACTIVE', 'TRIAL', 'GRACE_PERIOD', 'SUSPENDED', 'EXPIRED', 'CANCELLED'];

/** GET /platform/overview — headline counts for the operator dashboard. */
export async function getPlatformOverview(req, res, next) {
  try {
    const [companies, activeUsers, pendingRegistrations, licenceRows, contractAgg, statusRows] = await Promise.all([
      prisma.tenant.count({ where: CUSTOMER_TENANTS }),
      prisma.tenantUser.count({
        where: { isDeleted: false, status: 'ACTIVE', tenant: CUSTOMER_TENANTS },
      }),
      prisma.companyRegistration.count({ where: { status: { not: 'ACTIVE' } } }),
      prisma.tenant.findMany({ where: CUSTOMER_TENANTS, select: { licenseLimit: true } }),
      // Licence fees actually invoiced. This is a one-time contracted amount per
      // registration, NOT recurring revenue — there is no subscription/plan model
      // in the schema, so it must not be presented as MRR.
      prisma.companyRegistration.aggregate({
        where: { status: 'ACTIVE' },
        _sum: { totalAmount: true },
      }),
      prisma.tenant.groupBy({ by: ['status'], where: CUSTOMER_TENANTS, _count: { status: true } }),
    ]);

    const licencesPurchased = licenceRows.reduce((sum, t) => sum + (t.licenseLimit || 0), 0);

    // Every state gets a key even at zero, so the dashboard renders a stable set
    // of cards rather than one that appears and disappears.
    const byStatus = Object.fromEntries(TENANT_STATES.map((s) => [s, 0]));
    for (const row of statusRows) byStatus[row.status] = row._count.status;

    res.json({
      overview: {
        companies,
        activeUsers,
        pendingRegistrations,
        licencesPurchased,
        licencesUsed: activeUsers,
        licenceUtilisation: licencesPurchased > 0
          ? Math.round((activeUsers / licencesPurchased) * 100)
          : 0,
        // Rupees: unitPrice/GST are configured in INR (see env LICENSE_UNIT_PRICE).
        contractedValue: Number(contractAgg._sum.totalAmount || 0),
        currency: 'INR',
      },
      byStatus,
    });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /platform/tenants — one row per customer company.
 *
 * Company metadata plus a seat count. Deliberately no drill-down into the
 * tenant's own records.
 */
export async function listPlatformTenants(req, res, next) {
  try {
    const parsed = platformTenantQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Validation failed', details: parsed.error.issues });
    }
    const { search, page, limit } = parsed.data;

    const where = { ...CUSTOMER_TENANTS };
    if (search) {
      where.OR = [
        { companyName: { contains: search, mode: 'insensitive' } },
        { tenantCode: { contains: search, mode: 'insensitive' } },
        { domainName: { contains: search, mode: 'insensitive' } },
      ];
    }

    const skip = (page - 1) * limit;
    const [total, tenants] = await Promise.all([
      prisma.tenant.count({ where }),
      prisma.tenant.findMany({
        where,
        select: {
          id: true,
          companyName: true,
          tenantCode: true,
          domainName: true,
          licenseLimit: true,
          createdAt: true,
          // Commercial lifecycle — distinct from the onboarding status below.
          status: true,
          suspendedAt: true,
          suspendedReason: true,
          planEndsAt: true,
          // Onboarding record: carries the legal entity type, the approval
          // status and what was actually invoiced.
          registration: {
            select: { companyType: true, status: true, licenseQuantity: true, totalAmount: true },
          },
          // Same predicate as activeUsers in getPlatformOverview, so the table
          // rows sum to the headline figure rather than disagreeing with it.
          _count: { select: { users: { where: { isDeleted: false, status: 'ACTIVE' } } } },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
    ]);

    res.json({
      items: tenants.map((t) => ({
        id: t.id,
        companyName: t.companyName,
        tenantCode: t.tenantCode,
        domainName: t.domainName,
        licenseLimit: t.licenseLimit,
        userCount: t._count.users,
        createdAt: t.createdAt,
        // `companyType` is the legal entity type ("Private Limited"), not an
        // industry — the frontend labels it accordingly rather than inventing
        // a sector the schema does not record.
        companyType: t.registration?.companyType || null,
        // Two different things, kept apart because they answer different
        // questions: `status` is whether we let them in, `onboardingStatus` is
        // how far their signup got. A fully onboarded company can be suspended,
        // and a half-onboarded one is not suspended.
        status: t.status,
        suspendedAt: t.suspendedAt,
        suspendedReason: t.suspendedReason,
        planEndsAt: t.planEndsAt,
        // Tenants that predate the registration flow have no record; they exist,
        // so their onboarding is complete.
        onboardingStatus: t.registration?.status || 'ACTIVE',
        contractedValue: t.registration?.totalAmount != null
          ? Number(t.registration.totalAmount)
          : null,
      })),
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) || 1 },
    });
  } catch (err) {
    next(err);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// TENANT LIFECYCLE
// ─────────────────────────────────────────────────────────────────────────────

/**
 * POST /platform/tenants/:id/suspend
 *
 * Freezes a customer company. Their users can no longer sign in, and are told
 * why rather than being handed a generic 401 or a half-loaded app.
 *
 * The suspension and its audit row are written in one transaction: an
 * unrecorded suspension, or a record of one that did not happen, are both
 * worse than failing.
 */
export async function suspendTenant(req, res, next) {
  try {
    const parsedParams = tenantIdParamSchema.safeParse(req.params);
    if (!parsedParams.success) {
      return res.status(400).json({ error: 'Invalid parameters', details: parsedParams.error.issues });
    }
    const parsed = suspendTenantSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Validation failed', details: parsed.error.issues });
    }

    const tenant = await prisma.tenant.findUnique({
      where: { id: parsedParams.data.id },
      select: { id: true, companyName: true, status: true, isPlatform: true },
    });
    if (!tenant) {
      return res.status(404).json({ error: 'Company not found' });
    }
    // Suspending the platform's own tenant would lock the operator out of the
    // console they are using to do it.
    if (tenant.isPlatform) {
      return res.status(400).json({ error: 'The platform tenant cannot be suspended' });
    }
    if (tenant.status === 'SUSPENDED') {
      return res.status(409).json({ error: `${tenant.companyName} is already suspended` });
    }

    const now = new Date();
    const updated = await prisma.$transaction(async (tx) => {
      const t = await tx.tenant.update({
        where: { id: tenant.id },
        data: { status: 'SUSPENDED', suspendedAt: now, suspendedReason: parsed.data.reason },
        select: { id: true, companyName: true, status: true, suspendedAt: true, suspendedReason: true },
      });
      await recordPlatformAction({
        tx,
        req,
        action: PLATFORM_ACTIONS.TENANT_SUSPENDED,
        targetType: 'TENANT',
        targetId: tenant.id,
        tenantId: tenant.id,
        beforeValue: { status: tenant.status },
        afterValue: { status: 'SUSPENDED' },
        reason: parsed.data.reason,
      });
      return t;
    });

    // Existing JWTs stay valid until they expire, but requireAuth re-reads the
    // tenant on every request, so access stops on the next call either way.
    res.json({ tenant: updated });
  } catch (err) {
    next(err);
  }
}

/**
 * POST /platform/tenants/:id/restore
 *
 * Returns a suspended company to ACTIVE and clears the suspension metadata.
 */
export async function restoreTenant(req, res, next) {
  try {
    const parsedParams = tenantIdParamSchema.safeParse(req.params);
    if (!parsedParams.success) {
      return res.status(400).json({ error: 'Invalid parameters', details: parsedParams.error.issues });
    }

    const tenant = await prisma.tenant.findUnique({
      where: { id: parsedParams.data.id },
      select: { id: true, companyName: true, status: true, suspendedReason: true },
    });
    if (!tenant) {
      return res.status(404).json({ error: 'Company not found' });
    }
    if (tenant.status !== 'SUSPENDED') {
      return res.status(409).json({ error: `${tenant.companyName} is not suspended (status: ${tenant.status})` });
    }

    const updated = await prisma.$transaction(async (tx) => {
      const t = await tx.tenant.update({
        where: { id: tenant.id },
        data: { status: 'ACTIVE', suspendedAt: null, suspendedReason: null },
        select: { id: true, companyName: true, status: true },
      });
      await recordPlatformAction({
        tx,
        req,
        action: PLATFORM_ACTIONS.TENANT_RESTORED,
        targetType: 'TENANT',
        targetId: tenant.id,
        tenantId: tenant.id,
        beforeValue: { status: 'SUSPENDED', suspendedReason: tenant.suspendedReason },
        afterValue: { status: 'ACTIVE' },
      });
      return t;
    });

    res.json({ tenant: updated });
  } catch (err) {
    next(err);
  }
}

/** GET /platform/audit — what the operator has done. */
export async function getPlatformAudit(req, res, next) {
  try {
    const parsed = platformAuditQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Validation failed', details: parsed.error.issues });
    }
    res.json(await listPlatformAudit(parsed.data));
  } catch (err) {
    next(err);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// TENANT DETAIL, LIFECYCLE AND QUOTA
// ─────────────────────────────────────────────────────────────────────────────

/** Lifecycle states an operator may set through the generic endpoint. */
const SETTABLE_LIFECYCLE = ['ACTIVE', 'TRIAL', 'GRACE_PERIOD', 'EXPIRED', 'CANCELLED'];

/**
 * GET /platform/tenants/:id — everything about one company.
 *
 * Counts and company metadata only. The per-module numbers below are what tell
 * you whether a tenant actually uses what it bought, and they are deliberately
 * counts rather than records: no goal, task or message crosses this boundary.
 */
export async function getPlatformTenant(req, res, next) {
  try {
    const parsed = tenantIdParamSchema.safeParse(req.params);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid parameters', details: parsed.error.issues });
    }
    const { id } = parsed.data;

    const tenant = await prisma.tenant.findUnique({
      where: { id },
      select: {
        id: true, companyName: true, tenantCode: true, domainName: true,
        licenseLimit: true, createdAt: true, isPlatform: true,
        status: true, planEndsAt: true, suspendedAt: true, suspendedReason: true,
        registration: {
          select: {
            id: true, companyType: true, status: true, gstin: true,
            licenseQuantity: true, unitPrice: true, subtotalAmount: true,
            discountAmount: true, gstRate: true, gstAmount: true, totalAmount: true,
            paymentMethod: true, paymentReference: true, transactionId: true,
            chequeNumber: true, chequeDate: true,
            financeApprovedAt: true, activatedAt: true, createdAt: true,
          },
        },
      },
    });
    if (!tenant) return res.status(404).json({ error: 'Company not found' });

    const activeUsers = { tenantId: id, isDeleted: false, status: 'ACTIVE' };

    const [admins, userCount, goals, tasks, leaves, policies, disputes, audit] = await Promise.all([
      prisma.tenantUser.findMany({
        where: { ...activeUsers, role: { in: ['SUPER_ADMIN', 'ADMIN', 'HR'] } },
        select: { id: true, name: true, email: true, role: true, lastLoginAt: true },
        orderBy: { role: 'asc' },
      }),
      prisma.tenantUser.count({ where: activeUsers }),
      prisma.goal.count({ where: { tenantId: id } }),
      prisma.task.count({ where: { tenantId: id } }),
      prisma.leaveRequest.count({ where: { tenantId: id } }),
      prisma.policy.count({ where: { tenantId: id } }),
      prisma.dispute.count({ where: { tenantId: id } }),
      listPlatformAudit({ tenantId: id, page: 1, limit: 20 }),
    ]);

    const reg = tenant.registration;
    const num = (v) => (v == null ? null : Number(v));

    res.json({
      tenant: {
        id: tenant.id,
        companyName: tenant.companyName,
        tenantCode: tenant.tenantCode,
        domainName: tenant.domainName,
        createdAt: tenant.createdAt,
        isPlatform: tenant.isPlatform,
        status: tenant.status,
        planEndsAt: tenant.planEndsAt,
        suspendedAt: tenant.suspendedAt,
        suspendedReason: tenant.suspendedReason,
        companyType: reg?.companyType || null,
        gstin: reg?.gstin || null,
        onboardingStatus: reg?.status || 'ACTIVE',
        activatedAt: reg?.activatedAt || null,
      },
      licences: {
        limit: tenant.licenseLimit,
        used: userCount,
        available: Math.max(0, tenant.licenseLimit - userCount),
        // The guard in license.service.js reads `activeCount >= limit`, so a
        // limit of 0 blocks everyone rather than meaning unlimited.
        blocksAllCreation: tenant.licenseLimit === 0,
        overLimit: tenant.licenseLimit > 0 && userCount > tenant.licenseLimit,
      },
      // Already stored on the registration and shown nowhere until now.
      invoice: reg
        ? {
            licenseQuantity: reg.licenseQuantity,
            unitPrice: num(reg.unitPrice),
            subtotalAmount: num(reg.subtotalAmount),
            discountAmount: num(reg.discountAmount),
            gstRate: num(reg.gstRate),
            gstAmount: num(reg.gstAmount),
            totalAmount: num(reg.totalAmount),
            paymentMethod: reg.paymentMethod,
            paymentReference: reg.paymentReference,
            transactionId: reg.transactionId,
            chequeNumber: reg.chequeNumber,
            chequeDate: reg.chequeDate,
            financeApprovedAt: reg.financeApprovedAt,
            currency: 'INR',
          }
        : null,
      admins,
      usage: { users: userCount, goals, tasks, leaves, policies, disputes },
      audit: audit.items,
    });
  } catch (err) {
    next(err);
  }
}

/**
 * POST /platform/tenants/:id/lifecycle — move a company between states.
 *
 * Suspend and restore keep their own endpoints because they carry extra
 * semantics (a required reason, clearing suspension metadata). This covers the
 * rest: trial, grace period, expiry and cancellation.
 */
export async function setTenantLifecycle(req, res, next) {
  try {
    const parsedParams = tenantIdParamSchema.safeParse(req.params);
    if (!parsedParams.success) {
      return res.status(400).json({ error: 'Invalid parameters', details: parsedParams.error.issues });
    }
    const parsed = tenantLifecycleSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Validation failed', details: parsed.error.issues });
    }
    const { status, reason, planEndsAt } = parsed.data;

    const tenant = await prisma.tenant.findUnique({
      where: { id: parsedParams.data.id },
      select: { id: true, companyName: true, status: true, isPlatform: true, planEndsAt: true },
    });
    if (!tenant) return res.status(404).json({ error: 'Company not found' });
    if (tenant.isPlatform) {
      return res.status(400).json({ error: 'The platform tenant has no commercial lifecycle' });
    }
    if (tenant.status === status) {
      return res.status(409).json({ error: `${tenant.companyName} is already ${status}` });
    }
    // Cancelling ends a customer relationship; an unexplained one is useless in
    // the trail six months later.
    if (status === 'CANCELLED' && !reason) {
      return res.status(400).json({ error: 'A reason is required to cancel a company' });
    }

    const data = { status };
    // Leaving SUSPENDED through this endpoint clears the suspension metadata,
    // so a restored tenant does not keep showing a stale reason.
    if (tenant.status === 'SUSPENDED') {
      data.suspendedAt = null;
      data.suspendedReason = null;
    }
    if (planEndsAt !== undefined) {
      data.planEndsAt = planEndsAt ? new Date(planEndsAt) : null;
    }

    const updated = await prisma.$transaction(async (tx) => {
      const t = await tx.tenant.update({
        where: { id: tenant.id },
        data,
        select: { id: true, companyName: true, status: true, planEndsAt: true },
      });
      await recordPlatformAction({
        tx,
        req,
        action: PLATFORM_ACTIONS.TENANT_LIFECYCLE_CHANGED,
        targetType: 'TENANT',
        targetId: tenant.id,
        tenantId: tenant.id,
        beforeValue: { status: tenant.status, planEndsAt: tenant.planEndsAt },
        afterValue: { status: t.status, planEndsAt: t.planEndsAt },
        reason,
      });
      return t;
    });

    res.json({ tenant: updated });
  } catch (err) {
    next(err);
  }
}

/** PATCH /platform/tenants/:id/licences — grant or reduce seats. */
export async function updateTenantLicences(req, res, next) {
  try {
    const parsedParams = tenantIdParamSchema.safeParse(req.params);
    if (!parsedParams.success) {
      return res.status(400).json({ error: 'Invalid parameters', details: parsedParams.error.issues });
    }
    const parsed = tenantLicenceSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Validation failed', details: parsed.error.issues });
    }
    const { licenseLimit, reason } = parsed.data;

    const tenant = await prisma.tenant.findUnique({
      where: { id: parsedParams.data.id },
      select: { id: true, companyName: true, licenseLimit: true, isPlatform: true },
    });
    if (!tenant) return res.status(404).json({ error: 'Company not found' });
    // The platform's own tenant bought nothing and has no seat quota. Its limit
    // of 0 is deliberate — it is what stops anyone creating users inside the
    // operator tenant — so it must not be editable here, for the same reason
    // setTenantLifecycle refuses it.
    if (tenant.isPlatform) {
      return res.status(400).json({
        error: 'The platform tenant has no seat quota',
        code: 'PLATFORM_TENANT',
      });
    }

    const activeUsers = await prisma.tenantUser.count({
      where: { tenantId: tenant.id, isDeleted: false, status: 'ACTIVE' },
    });

    // Zero is a trap, not "unlimited". assertLicenseAvailable in
    // license.service.js reads `activeCount >= tenant.licenseLimit`, so a limit
    // of 0 blocks EVERY user creation for that company, silently. Refuse it
    // here until that semantic is deliberately decided.
    if (licenseLimit === 0) {
      return res.status(400).json({
        error: 'A limit of 0 blocks all user creation for this company rather than meaning unlimited. Set a positive number.',
        code: 'ZERO_LICENCE_LIMIT',
      });
    }

    // Setting a limit below current headcount does not remove anyone, but it
    // does stop the next invite. Say so rather than silently doing it.
    if (licenseLimit < activeUsers) {
      return res.status(409).json({
        error: `${tenant.companyName} already has ${activeUsers} active users. Reducing the limit to ${licenseLimit} would block new invitations; deactivate users first.`,
      });
    }

    const updated = await prisma.$transaction(async (tx) => {
      const t = await tx.tenant.update({
        where: { id: tenant.id },
        data: { licenseLimit },
        select: { id: true, companyName: true, licenseLimit: true },
      });
      await recordPlatformAction({
        tx,
        req,
        action: PLATFORM_ACTIONS.TENANT_LICENCES_CHANGED,
        targetType: 'TENANT',
        targetId: tenant.id,
        tenantId: tenant.id,
        beforeValue: { licenseLimit: tenant.licenseLimit },
        afterValue: { licenseLimit: t.licenseLimit },
        reason,
      });
      return t;
    });

    res.json({ tenant: updated, activeUsers });
  } catch (err) {
    next(err);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// GLOBAL USER MANAGEMENT
// ─────────────────────────────────────────────────────────────────────────────
//
// The only place in the product that looks at users across tenant boundaries.
// It returns identity and account state — never a goal, task, message, appraisal
// or any other record belonging to a company.

const PLATFORM_USER_SELECT = {
  id: true,
  name: true,
  email: true,
  role: true,
  status: true,
  designation: true,
  department: true,
  isDeleted: true,
  lastLoginAt: true,
  createdAt: true,
  tenantId: true,
  tenant: { select: { id: true, companyName: true, tenantCode: true, status: true } },
};

/**
 * Loads a user for an operator action and enforces the one rule that protects
 * the console from itself: a PLATFORM_OWNER can never be deactivated or reset
 * from here, or an operator could lock every operator out.
 */
async function loadOperableUser(res, id) {
  const user = await prisma.tenantUser.findUnique({
    where: { id },
    select: { ...PLATFORM_USER_SELECT, tenant: { select: { companyName: true } } },
  });
  if (!user) {
    res.status(404).json({ error: 'User not found' });
    return null;
  }
  if (user.role === 'PLATFORM_OWNER') {
    res.status(403).json({
      error: 'Platform owners cannot be managed from this console. Use the seed script.',
      code: 'PLATFORM_OWNER_PROTECTED',
    });
    return null;
  }
  return user;
}

/** GET /platform/users — search every user on the platform. */
export async function listPlatformUsers(req, res, next) {
  try {
    const parsed = platformUserQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Validation failed', details: parsed.error.issues });
    }
    const { search, tenantId, role, status, includeDeleted, page, limit } = parsed.data;

    const where = {
      // The platform's own operators are not "users of the platform" in this
      // sense, and listing them here invites managing them here.
      role: { not: 'PLATFORM_OWNER' },
      ...(includeDeleted ? {} : { isDeleted: false }),
      ...(tenantId ? { tenantId } : {}),
      ...(role ? { role } : {}),
      ...(status ? { status } : {}),
    };
    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { email: { contains: search, mode: 'insensitive' } },
      ];
    }

    const skip = (page - 1) * limit;
    const [total, users] = await Promise.all([
      prisma.tenantUser.count({ where }),
      prisma.tenantUser.findMany({
        where,
        select: PLATFORM_USER_SELECT,
        orderBy: [{ lastLoginAt: { sort: 'desc', nulls: 'last' } }, { createdAt: 'desc' }],
        skip,
        take: limit,
      }),
    ]);

    res.json({
      items: users,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) || 1 },
    });
  } catch (err) {
    next(err);
  }
}

/** GET /platform/users/:id — one user, plus their capability grants. */
export async function getPlatformUser(req, res, next) {
  try {
    const parsed = platformUserIdParamSchema.safeParse(req.params);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid parameters', details: parsed.error.issues });
    }

    const user = await prisma.tenantUser.findUnique({
      where: { id: parsed.data.id },
      select: PLATFORM_USER_SELECT,
    });
    if (!user) return res.status(404).json({ error: 'User not found' });

    const [capabilities, manages] = await Promise.all([
      prisma.userCapability.findMany({
        where: { userId: user.id },
        select: { capability: true, createdAt: true },
      }),
      // Useful on a support call: deactivating a manager orphans their reports.
      prisma.tenantUser.count({ where: { managerId: user.id, isDeleted: false } }),
    ]);

    res.json({ user, capabilities, directReports: manages });
  } catch (err) {
    next(err);
  }
}

/**
 * POST /platform/users/:id/deactivate — cut off an account in any tenant.
 *
 * Sets status to EXITED, which requireAuth already refuses, so access stops on
 * the very next request rather than whenever the JWT happens to expire.
 */
export async function deactivatePlatformUser(req, res, next) {
  try {
    const parsedParams = platformUserIdParamSchema.safeParse(req.params);
    if (!parsedParams.success) {
      return res.status(400).json({ error: 'Invalid parameters', details: parsedParams.error.issues });
    }
    const parsed = platformUserActionSchema.safeParse(req.body || {});
    if (!parsed.success) {
      return res.status(400).json({ error: 'Validation failed', details: parsed.error.issues });
    }

    const user = await loadOperableUser(res, parsedParams.data.id);
    if (!user) return null;
    if (user.status === 'EXITED') {
      return res.status(409).json({ error: `${user.name} is already deactivated` });
    }

    const updated = await prisma.$transaction(async (tx) => {
      const u = await tx.tenantUser.update({
        where: { id: user.id },
        data: { status: 'EXITED' },
        select: { id: true, name: true, email: true, status: true },
      });
      await recordPlatformAction({
        tx,
        req,
        action: PLATFORM_ACTIONS.USER_DEACTIVATED,
        targetType: 'USER',
        targetId: user.id,
        tenantId: user.tenantId,
        beforeValue: { status: user.status },
        afterValue: { status: 'EXITED' },
        reason: parsed.data.reason,
      });
      return u;
    });

    res.json({ user: updated });
  } catch (err) {
    next(err);
  }
}

/** POST /platform/users/:id/reactivate — undo the above. */
export async function reactivatePlatformUser(req, res, next) {
  try {
    const parsedParams = platformUserIdParamSchema.safeParse(req.params);
    if (!parsedParams.success) {
      return res.status(400).json({ error: 'Invalid parameters', details: parsedParams.error.issues });
    }
    const parsed = platformUserActionSchema.safeParse(req.body || {});
    if (!parsed.success) {
      return res.status(400).json({ error: 'Validation failed', details: parsed.error.issues });
    }

    const user = await loadOperableUser(res, parsedParams.data.id);
    if (!user) return null;
    if (user.status !== 'EXITED') {
      return res.status(409).json({ error: `${user.name} is not deactivated (status: ${user.status})` });
    }
    if (user.isDeleted) {
      return res.status(409).json({ error: `${user.name} has been deleted and cannot be reactivated here` });
    }

    const updated = await prisma.$transaction(async (tx) => {
      const u = await tx.tenantUser.update({
        where: { id: user.id },
        data: { status: 'ACTIVE' },
        select: { id: true, name: true, email: true, status: true },
      });
      await recordPlatformAction({
        tx,
        req,
        action: PLATFORM_ACTIONS.USER_REACTIVATED,
        targetType: 'USER',
        targetId: user.id,
        tenantId: user.tenantId,
        beforeValue: { status: 'EXITED' },
        afterValue: { status: 'ACTIVE' },
        reason: parsed.data.reason,
      });
      return u;
    });

    res.json({ user: updated });
  } catch (err) {
    next(err);
  }
}

/**
 * POST /platform/users/:id/force-reset — send a password reset to a user.
 *
 * For the locked-out-admin support call. It issues the same token the public
 * forgot-password flow does, so there is one reset mechanism rather than an
 * operator back door: the password itself is never set or revealed here.
 */
export async function forceResetPlatformUser(req, res, next) {
  try {
    const parsedParams = platformUserIdParamSchema.safeParse(req.params);
    if (!parsedParams.success) {
      return res.status(400).json({ error: 'Invalid parameters', details: parsedParams.error.issues });
    }
    const parsed = platformUserActionSchema.safeParse(req.body || {});
    if (!parsed.success) {
      return res.status(400).json({ error: 'Validation failed', details: parsed.error.issues });
    }

    const user = await loadOperableUser(res, parsedParams.data.id);
    if (!user) return null;
    if (user.isDeleted || user.status === 'EXITED') {
      return res.status(409).json({ error: `${user.name} is not an active account` });
    }

    const rawToken = generateRawToken();
    const tokenHash = hashToken(rawToken);
    const expiresMinutes = env.passwordResetTokenExpiresMinutes || 30;
    const expiresAt = new Date(Date.now() + expiresMinutes * 60 * 1000);
    const tokenId = `prt_${crypto.randomBytes(12).toString('hex')}`;

    await prisma.$transaction(async (tx) => {
      // Same invalidate-then-issue as forgot-password, so an operator reset and
      // a self-service reset cannot both be live at once.
      await tx.$executeRawUnsafe(
        `UPDATE "password_reset_tokens" SET "usedAt" = CURRENT_TIMESTAMP
         WHERE "userId" = $1 AND "usedAt" IS NULL`,
        user.id,
      );
      await tx.$executeRawUnsafe(
        `INSERT INTO "password_reset_tokens" ("id", "userId", "tokenHash", "expiresAt", "usedAt", "createdAt")
         VALUES ($1, $2, $3, $4, NULL, CURRENT_TIMESTAMP)`,
        tokenId, user.id, tokenHash, expiresAt,
      );
      await recordPlatformAction({
        tx,
        req,
        action: PLATFORM_ACTIONS.USER_PASSWORD_RESET_SENT,
        targetType: 'USER',
        targetId: user.id,
        tenantId: user.tenantId,
        afterValue: { email: user.email, expiresAt },
        reason: parsed.data.reason,
      });
    });

    const { html, text } = renderPasswordResetEmail({
      resetUrl: `${env.frontendOrigin}/reset-password?token=${rawToken}`,
      expiresMinutes,
      name: user.name,
    });
    await sendMail({
      to: user.email,
      subject: 'Reset your UEIBI password',
      html,
      text,
      event: 'AUTH_PASSWORD_RESET',
    }).catch((err) => {
      // The token is already issued and valid; a mail failure must not imply
      // otherwise, but the operator needs to know it did not arrive.
      console.warn('[Platform] Reset email failed to send:', err.message);
    });

    res.json({ sent: true, email: user.email, expiresAt });
  } catch (err) {
    next(err);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// TENANT ONBOARDING AND VERIFICATION
// ─────────────────────────────────────────────────────────────────────────────
//
// Both read the same CompanyRegistration rows: onboarding tracks where a company
// has got to in the signup flow, verification records what an operator decided
// about it. Neither can advance a registration — approval stays with the emailed
// action links, which are the path live companies are onboarding through.

/** How long a registration may sit in one stage before it is worth chasing. */
const STUCK_AFTER_DAYS = 3;

/** The stages a registration moves through, in order. */
const STAGE_ORDER = [
  'PENDING_FINANCE_REVIEW',
  'PENDING_CHEQUE_CONFIRMATION',
  'PENDING_HR_ACTIVATION',
  'ACTIVE',
];

/**
 * Who has to act at each stage, and where their link goes. ACTIVE is absent
 * because there is nothing left to chase.
 */
const STAGE_ACTION = {
  PENDING_FINANCE_REVIEW: {
    role: 'FINANCE',
    recipientField: 'financeEmail',
    path: 'finance/registrations',
    event: 'LEVEL1_SUBMITTED',
    label: 'Finance review',
  },
  PENDING_CHEQUE_CONFIRMATION: {
    role: 'FINANCE',
    recipientField: 'financeEmail',
    path: 'finance/registrations',
    event: 'FINANCE_APPROVED_CHEQUE',
    label: 'Cheque confirmation',
  },
  PENDING_HR_ACTIVATION: {
    role: 'HR',
    recipientField: 'hrEmail',
    path: 'hr/registrations',
    event: 'FINANCE_APPROVED_CHEQUE',
    label: 'HR activation',
  },
};

const daysSince = (date) => Math.floor((Date.now() - new Date(date).getTime()) / 86400000);

/**
 * GET /platform/registrations — the onboarding queue.
 *
 * Every registration with how long it has sat where it is, whether its
 * notification emails actually landed, and what an operator has decided about
 * it. The age and stuck flag are what turn a list into a queue.
 */
export async function listOnboarding(req, res, next) {
  try {
    const parsed = onboardingQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Validation failed', details: parsed.error.issues });
    }
    const { status, search, stuckOnly, page, limit } = parsed.data;

    // "Stuck" is age in stage, which is updatedAt against a threshold — an
    // ordinary predicate, so it belongs in the query rather than in a filter
    // over one page of results that would make the counts lie.
    const stuckBefore = new Date(Date.now() - STUCK_AFTER_DAYS * 86400000);

    const where = {
      // Both filters touch `status`, so they are composed rather than spread:
      // an explicit stage wins, and stuckOnly then only adds the age predicate.
      ...(status ? { status } : stuckOnly ? { status: { not: 'ACTIVE' } } : {}),
      ...(stuckOnly ? { updatedAt: { lt: stuckBefore } } : {}),
      ...(search
        ? {
            OR: [
              { companyName: { contains: search, mode: 'insensitive' } },
              { email: { contains: search, mode: 'insensitive' } },
              { domainName: { contains: search, mode: 'insensitive' } },
              { fullName: { contains: search, mode: 'insensitive' } },
              { tenantCode: { contains: search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };

    const skip = (page - 1) * limit;
    const [total, rows, stageCounts] = await Promise.all([
      prisma.companyRegistration.count({ where }),
      prisma.companyRegistration.findMany({
        where,
        select: {
          id: true, companyName: true, companyType: true, domainName: true,
          tenantCode: true, fullName: true, designation: true, email: true,
          financeEmail: true, hrEmail: true, gstin: true,
          licenseQuantity: true, totalAmount: true, paymentMethod: true,
          status: true, financeApprovedAt: true, activatedAt: true,
          createdAt: true, updatedAt: true,
          tenant: { select: { id: true, companyName: true, status: true } },
        },
        orderBy: { updatedAt: 'asc' },   // oldest-waiting first: this is a queue
        skip,
        take: limit,
      }),
      prisma.companyRegistration.groupBy({ by: ['status'], _count: { status: true } }),
    ]);

    const ids = rows.map((r) => r.id);

    // A bounced onboarding email is invisible today: the company never hears
    // from us and nothing in the console says so.
    const [failures, verifications] = await Promise.all([
      ids.length
        ? prisma.notificationLog.groupBy({
            by: ['registrationId'],
            where: { registrationId: { in: ids }, status: { notIn: ['SENT', 'DEV_LOGGED'] } },
            _count: { _all: true },
          })
        : [],
      ids.length
        ? prisma.registrationVerification.findMany({
            where: { registrationId: { in: ids } },
            select: { registrationId: true, status: true, createdAt: true },
            orderBy: { createdAt: 'desc' },
          })
        : [],
    ]);

    const failuresById = Object.fromEntries(failures.map((f) => [f.registrationId, f._count._all]));
    // findMany came back newest-first, so the first sighting of each id is current.
    const verdictById = {};
    for (const v of verifications) {
      if (!verdictById[v.registrationId]) verdictById[v.registrationId] = v.status;
    }

    const items = rows.map((r) => {
      const ageInStage = daysSince(r.updatedAt);
      return {
        ...r,
        totalAmount: r.totalAmount == null ? null : Number(r.totalAmount),
        stageLabel: STAGE_ACTION[r.status]?.label || 'Live',
        waitingOn: STAGE_ACTION[r.status]?.role || null,
        ageInStage,
        ageOverall: daysSince(r.createdAt),
        // ACTIVE is a finished state, so it can never be "stuck".
        stuck: r.status !== 'ACTIVE' && ageInStage >= STUCK_AFTER_DAYS,
        failedNotifications: failuresById[r.id] || 0,
        verification: verdictById[r.id] || 'PENDING',
      };
    });

    const byStatus = Object.fromEntries(STAGE_ORDER.map((s) => [s, 0]));
    for (const c of stageCounts) byStatus[c.status] = c._count.status;

    res.json({
      items,
      summary: {
        total: Object.values(byStatus).reduce((a, b) => a + b, 0),
        byStatus,
        stuckThresholdDays: STUCK_AFTER_DAYS,
      },
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) || 1 },
    });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /platform/registrations/:id — one registration, everything known about it.
 *
 * Includes the action tokens' state but never their hashes: whether a link was
 * issued, whether it expired and whether anybody clicked it is exactly what an
 * operator needs on a "we never got the email" call.
 */
export async function getOnboarding(req, res, next) {
  try {
    const parsed = registrationIdParamSchema.safeParse(req.params);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid parameters', details: parsed.error.issues });
    }

    const reg = await prisma.companyRegistration.findUnique({
      where: { id: parsed.data.id },
      select: {
        id: true, companyName: true, companyType: true, domainName: true,
        tenantCode: true, fullName: true, designation: true, email: true,
        financeEmail: true, hrEmail: true, acceptedTermsAt: true, gstin: true,
        licenseQuantity: true, unitPrice: true, subtotalAmount: true,
        discountAmount: true, gstRate: true, gstAmount: true, totalAmount: true,
        paymentMethod: true, paymentReference: true, chequeNumber: true,
        chequeDate: true, transactionId: true,
        financeApprovedAt: true, activatedAt: true, status: true,
        createdAt: true, updatedAt: true,
        tenant: {
          select: {
            id: true, companyName: true, tenantCode: true, status: true,
            licenseLimit: true, createdAt: true,
          },
        },
        coupon: { select: { code: true, discountType: true, discountValue: true, bdmName: true } },
        // Never tokenHash — that is the credential itself.
        actionTokens: {
          select: { id: true, role: true, expiresAt: true, lastUsedAt: true, createdAt: true },
          orderBy: { createdAt: 'desc' },
        },
        notificationLogs: {
          select: {
            id: true, event: true, recipient: true, subject: true,
            status: true, error: true, createdAt: true,
          },
          orderBy: { createdAt: 'desc' },
          take: 50,
        },
      },
    });
    if (!reg) return res.status(404).json({ error: 'Registration not found' });

    const num = (v) => (v == null ? null : Number(v));
    const now = Date.now();
    const ageInStage = daysSince(reg.updatedAt);

    res.json({
      registration: {
        ...reg,
        unitPrice: num(reg.unitPrice), subtotalAmount: num(reg.subtotalAmount),
        discountAmount: num(reg.discountAmount), gstRate: num(reg.gstRate),
        gstAmount: num(reg.gstAmount), totalAmount: num(reg.totalAmount),
        stageLabel: STAGE_ACTION[reg.status]?.label || 'Live',
        waitingOn: STAGE_ACTION[reg.status]?.role || null,
        waitingOnEmail: STAGE_ACTION[reg.status]
          ? reg[STAGE_ACTION[reg.status].recipientField]
          : null,
        ageInStage,
        stuck: reg.status !== 'ACTIVE' && ageInStage >= STUCK_AFTER_DAYS,
      },
      tokens: reg.actionTokens.map((t) => ({
        ...t,
        expired: new Date(t.expiresAt).getTime() < now,
        used: Boolean(t.lastUsedAt),
      })),
      notifications: reg.notificationLogs,
      failedNotifications: reg.notificationLogs.filter(
        (n) => !['SENT', 'DEV_LOGGED'].includes(n.status),
      ).length,
    });
  } catch (err) {
    next(err);
  }
}

/**
 * POST /platform/registrations/:id/resend — re-issue the current stage's link.
 *
 * Mints a FRESH token rather than resending the old one, because tokens are
 * stored hashed and the original raw value is unrecoverable by design. The
 * registration's status is never touched: this chases a stalled step, it does
 * not advance one.
 *
 * Only the person who actually has to act is emailed. The original transition
 * copied in all four stakeholders; repeating that on every chase would train
 * them to ignore it.
 */
export async function resendOnboardingLink(req, res, next) {
  try {
    const parsedParams = registrationIdParamSchema.safeParse(req.params);
    if (!parsedParams.success) {
      return res.status(400).json({ error: 'Invalid parameters', details: parsedParams.error.issues });
    }
    const parsed = platformUserActionSchema.safeParse(req.body || {});
    if (!parsed.success) {
      return res.status(400).json({ error: 'Validation failed', details: parsed.error.issues });
    }

    const reg = await prisma.companyRegistration.findUnique({
      where: { id: parsedParams.data.id },
      select: {
        id: true, companyName: true, status: true, email: true,
        financeEmail: true, hrEmail: true, fullName: true,
        licenseQuantity: true, totalAmount: true, paymentMethod: true,
        domainName: true, tenantCode: true, companyType: true, gstin: true,
      },
    });
    if (!reg) return res.status(404).json({ error: 'Registration not found' });

    const stage = STAGE_ACTION[reg.status];
    if (!stage) {
      return res.status(409).json({
        error: `${reg.companyName} is already active — there is no pending step to resend.`,
        code: 'NOTHING_TO_RESEND',
      });
    }

    const recipient = reg[stage.recipientField];
    if (!recipient) {
      return res.status(409).json({ error: `No ${stage.role} email is recorded for this registration.` });
    }

    const rawToken = generateRawToken();
    const expiresAt = new Date(Date.now() + env.actionTokenTtlDays * 24 * 60 * 60 * 1000);

    await prisma.$transaction(async (tx) => {
      await tx.registrationActionToken.create({
        data: {
          registrationId: reg.id,
          role: stage.role,
          tokenHash: hashToken(rawToken),
          expiresAt,
        },
      });
      await recordPlatformAction({
        tx,
        req,
        action: PLATFORM_ACTIONS.REGISTRATION_LINK_RESENT,
        targetType: 'REGISTRATION',
        targetId: reg.id,
        // No tenant exists until HR activation, so this is null for most rows.
        tenantId: null,
        afterValue: { stage: reg.status, role: stage.role, recipient, expiresAt },
        reason: parsed.data.reason,
      });
    });

    const actionUrl = `${env.frontendOrigin}/${stage.path}/${rawToken}`;
    const message = `A new ${stage.label.toLowerCase()} link has been issued for ${reg.companyName}.`;

    // sendMail records its own NotificationLog row and resolves with a status
    // rather than throwing, so a bounce shows up in the trail either way.
    const mail = await sendMail({
      to: recipient,
      subject: `Action required: ${stage.label} for ${reg.companyName}`,
      text: `${message}\n\nAction required: ${actionUrl}`,
      html: renderResendEmail({ registration: reg, stage, actionUrl }),
      event: stage.event,
      registrationId: reg.id,
    });

    // The token is live regardless of whether the mail left the building; the
    // operator needs to know which of those two happened.
    res.json({
      sent: mail.status !== 'FAILED',
      recipient,
      role: stage.role,
      stage: reg.status,
      expiresAt,
      deliveryStatus: mail.status,
      deliveryError: mail.error || null,
    });
  } catch (err) {
    next(err);
  }
}

/** The resend email: short, because it is a nudge rather than an announcement. */
function renderResendEmail({ registration, stage, actionUrl }) {
  return renderEmailWrapper({
    title: `${stage.label} pending`,
    preheader: `${registration.companyName} is waiting on ${stage.role.toLowerCase()}.`,
    contentHtml: `
      <p style="margin:0 0 14px">Hello,</p>
      <p style="margin:0 0 14px">
        The registration for <strong>${registration.companyName}</strong> is still waiting
        on <strong>${stage.label.toLowerCase()}</strong>. This is a fresh link — any earlier
        one you may have received no longer applies.
      </p>
      <p style="margin:0 0 22px">
        <a href="${actionUrl}" style="background:#6366f1;color:#fff;padding:11px 22px;border-radius:7px;text-decoration:none;display:inline-block;font-weight:600">
          Open ${stage.label.toLowerCase()}
        </a>
      </p>
      <p style="margin:0;font-size:12px;color:#64748b">
        If the button does not work, copy this address into your browser:<br/>
        <span style="word-break:break-all">${actionUrl}</span>
      </p>
    `,
  });
}

/**
 * POST /platform/registrations/:id/verify — record a review decision.
 *
 * Appends a row rather than updating one, so a decision is never silently
 * overwritten and the history is a by-product of how it is stored. The newest
 * row is the current status.
 *
 * This is a review of the details the company submitted at signup. It does not
 * gate onboarding — a rejected company is not blocked automatically, because
 * the operator may want to chase it before shutting it down.
 */
export async function verifyRegistration(req, res, next) {
  try {
    const parsedParams = registrationIdParamSchema.safeParse(req.params);
    if (!parsedParams.success) {
      return res.status(400).json({ error: 'Invalid parameters', details: parsedParams.error.issues });
    }
    const parsed = registrationVerifySchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Validation failed', details: parsed.error.issues });
    }
    const { status, notes } = parsed.data;

    const reg = await prisma.companyRegistration.findUnique({
      where: { id: parsedParams.data.id },
      select: { id: true, companyName: true, tenant: { select: { id: true } } },
    });
    if (!reg) return res.status(404).json({ error: 'Registration not found' });

    const previous = await prisma.registrationVerification.findFirst({
      where: { registrationId: reg.id },
      orderBy: { createdAt: 'desc' },
      select: { status: true },
    });
    if (previous?.status === status) {
      return res.status(409).json({ error: `${reg.companyName} is already marked ${status}.` });
    }
    // A rejection that says nothing is useless to whoever picks this up later.
    if (status === 'REJECTED' && !notes) {
      return res.status(400).json({ error: 'A note is required when rejecting a registration' });
    }

    const row = await prisma.$transaction(async (tx) => {
      const created = await tx.registrationVerification.create({
        data: {
          registrationId: reg.id,
          status,
          notes: notes || null,
          reviewerId: req.user.id,
        },
        select: { id: true, status: true, notes: true, createdAt: true },
      });
      await recordPlatformAction({
        tx,
        req,
        action: PLATFORM_ACTIONS.REGISTRATION_VERIFIED,
        targetType: 'REGISTRATION',
        targetId: reg.id,
        tenantId: reg.tenant?.id || null,
        beforeValue: { verification: previous?.status || 'PENDING' },
        afterValue: { verification: status },
        reason: notes,
      });
      return created;
    });

    res.json({ verification: row });
  } catch (err) {
    next(err);
  }
}

/** GET /platform/registrations/:id/verification — every decision, newest first. */
export async function getRegistrationVerification(req, res, next) {
  try {
    const parsed = registrationIdParamSchema.safeParse(req.params);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid parameters', details: parsed.error.issues });
    }

    const reg = await prisma.companyRegistration.findUnique({
      where: { id: parsed.data.id },
      select: { id: true },
    });
    if (!reg) return res.status(404).json({ error: 'Registration not found' });

    const rows = await prisma.registrationVerification.findMany({
      where: { registrationId: reg.id },
      orderBy: { createdAt: 'desc' },
      select: { id: true, status: true, notes: true, reviewerId: true, createdAt: true },
    });

    // reviewerId is not a foreign key, for the same reason actorId is not one on
    // the audit log: a decision must outlive the account that made it.
    const reviewerIds = [...new Set(rows.map((r) => r.reviewerId))];
    const reviewers = reviewerIds.length
      ? await prisma.tenantUser.findMany({
          where: { id: { in: reviewerIds } },
          select: { id: true, name: true, email: true },
        })
      : [];
    const byId = Object.fromEntries(reviewers.map((r) => [r.id, r]));

    res.json({
      current: rows[0]?.status || 'PENDING',
      history: rows.map((r) => ({
        ...r,
        reviewer: byId[r.reviewerId] || { id: r.reviewerId, name: 'Deleted account', email: null },
      })),
    });
  } catch (err) {
    next(err);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// ALERTS
// ─────────────────────────────────────────────────────────────────────────────

/** A trial or plan ending within this many days is worth knowing about. */
const EXPIRY_WARNING_DAYS = 7;
/** A registration untouched for this long has stalled. */
const STUCK_REGISTRATION_DAYS = 3;

/**
 * GET /platform/alerts — what needs attention right now.
 *
 * Computed on every request and never stored. Nothing in this product expires
 * or escalates on its own: there is no scheduler, so an alert is a prompt for
 * the operator to act, not a record that something happened. That is why a
 * dismissed alert is not a concept here — fix the underlying thing and it goes.
 *
 * Each alert carries a `tenantId` or `registrationId` so the UI can link
 * straight to the page where it can be dealt with.
 */
export async function getPlatformAlerts(req, res, next) {
  try {
    const now = new Date();
    const soon = new Date(now.getTime() + EXPIRY_WARNING_DAYS * 86400000);
    const stuckBefore = new Date(now.getTime() - STUCK_REGISTRATION_DAYS * 86400000);

    const [tenants, stuckRegistrations, failedMail, unverifiedPayments] = await Promise.all([
      prisma.tenant.findMany({
        where: CUSTOMER_TENANTS,
        select: {
          id: true, companyName: true, status: true, licenseLimit: true, planEndsAt: true,
          _count: {
            select: {
              users: { where: { isDeleted: false, status: 'ACTIVE' } },
            },
          },
        },
      }),
      prisma.companyRegistration.findMany({
        where: { status: { not: 'ACTIVE' }, updatedAt: { lt: stuckBefore } },
        select: { id: true, companyName: true, status: true, updatedAt: true },
        orderBy: { updatedAt: 'asc' },
      }),
      // A bounced onboarding email means the company never heard from us. The
      // send is logged, but nothing surfaced it until now.
      prisma.notificationLog.findMany({
        where: {
          status: { notIn: ['SENT', 'DEV_LOGGED'] },
          createdAt: { gt: new Date(now.getTime() - 30 * 86400000) },
        },
        select: { id: true, registrationId: true, recipient: true, event: true, error: true, createdAt: true },
        orderBy: { createdAt: 'desc' },
        take: 50,
      }),
      // Payments carried forward from the pre-billing signup flow. Their
      // references came from a stub path that never touched a payment gateway,
      // so they are counted as received but cannot be proved. They stay here
      // until reconciled against a bank statement.
      prisma.payment.findMany({
        where: { method: 'LEGACY' },
        select: {
          id: true, amount: true, reference: true, tenantId: true, receivedAt: true,
          invoice: { select: { id: true, invoiceNumber: true, billToName: true } },
        },
        orderBy: { receivedAt: 'asc' },
      }),
    ]);

    // Which tenants have nobody who can administer them. One query rather than
    // one per tenant.
    const adminRows = await prisma.tenantUser.groupBy({
      by: ['tenantId'],
      where: {
        isDeleted: false,
        status: 'ACTIVE',
        role: { in: ['SUPER_ADMIN', 'ADMIN', 'HR'] },
        tenant: CUSTOMER_TENANTS,
      },
      _count: { _all: true },
    });
    const adminCountBy = Object.fromEntries(adminRows.map((r) => [r.tenantId, r._count._all]));

    const alerts = [];
    const add = (a) => alerts.push(a);

    for (const t of tenants) {
      const used = t._count.users;

      // A limit of 0 blocks every invitation rather than meaning unlimited —
      // the guard in license.service.js reads `activeCount >= limit`.
      if (t.licenseLimit === 0) {
        add({
          severity: 'warning',
          kind: 'LICENCE_ZERO',
          tenantId: t.id,
          title: `${t.companyName} has a seat limit of 0`,
          detail: 'No new user can be created. A limit of 0 blocks everyone rather than meaning unlimited.',
        });
      } else if (used > t.licenseLimit) {
        add({
          severity: 'critical',
          kind: 'OVER_LICENCE',
          tenantId: t.id,
          title: `${t.companyName} is over its seat limit`,
          detail: `${used} active users against ${t.licenseLimit} purchased. New invitations are blocked.`,
        });
      } else if (t.licenseLimit > 0 && used === t.licenseLimit) {
        add({
          severity: 'info',
          kind: 'LICENCE_FULL',
          tenantId: t.id,
          title: `${t.companyName} has used every seat`,
          detail: `${used} of ${t.licenseLimit}. The next invitation will be refused.`,
        });
      }

      if (t.planEndsAt && !['CANCELLED', 'EXPIRED'].includes(t.status)) {
        const ends = new Date(t.planEndsAt);
        if (ends < now) {
          add({
            severity: 'critical',
            kind: 'PLAN_OVERDUE',
            tenantId: t.id,
            title: `${t.companyName} is past its plan end date`,
            detail: `Ended ${ends.toISOString().slice(0, 10)} and is still ${t.status}. Nothing expires automatically — move them yourself.`,
          });
        } else if (ends < soon) {
          add({
            severity: 'warning',
            kind: 'PLAN_ENDING',
            tenantId: t.id,
            title: `${t.companyName} ends on ${ends.toISOString().slice(0, 10)}`,
            detail: `${t.status === 'TRIAL' ? 'Trial' : 'Plan'} ends within ${EXPIRY_WARNING_DAYS} days.`,
          });
        }
      }

      // Only worth raising for a company that can actually be used; a cancelled
      // tenant having no admin is not a problem to solve.
      if (!['CANCELLED', 'SUSPENDED', 'EXPIRED'].includes(t.status) && !adminCountBy[t.id]) {
        add({
          severity: 'critical',
          kind: 'NO_ADMIN',
          tenantId: t.id,
          title: `${t.companyName} has no active administrator`,
          detail: 'Nobody there can manage their own users, approve leave or run appraisals.',
        });
      }
    }

    for (const r of stuckRegistrations) {
      const waiting = Math.floor((now - new Date(r.updatedAt)) / 86400000);
      add({
        severity: waiting >= 14 ? 'critical' : 'warning',
        kind: 'ONBOARDING_STALLED',
        registrationId: r.id,
        title: `${r.companyName} has been waiting ${waiting} days`,
        detail: `Stuck at ${r.status.replace(/_/g, ' ').toLowerCase()}. Resend the action link or call them.`,
      });
    }

    for (const m of failedMail) {
      add({
        severity: 'warning',
        kind: 'EMAIL_FAILED',
        registrationId: m.registrationId,
        title: `An email to ${m.recipient} did not send`,
        detail: `${m.event}: ${m.error || 'no error recorded'}. They are waiting on something they never received.`,
      });
    }

    // Grouped into one alert rather than eight, because the action is one job:
    // sit down with a bank statement and tick them off.
    if (unverifiedPayments.length > 0) {
      const sum = unverifiedPayments.reduce((a, p) => a + Number(p.amount || 0), 0);
      add({
        severity: 'warning',
        kind: 'UNVERIFIED_PAYMENT',
        invoiceId: unverifiedPayments[0].invoice?.id || null,
        title: `${unverifiedPayments.length} payment${unverifiedPayments.length === 1 ? '' : 's'} totalling ₹${sum.toLocaleString('en-IN')} cannot be verified`,
        detail: 'These were carried forward from the old signup flow. Their references never went through a payment gateway, so they are counted as received but unproven. Reconcile them against your bank and correct any that never arrived.',
        items: unverifiedPayments.map((p) => ({
          invoiceId: p.invoice?.id,
          invoiceNumber: p.invoice?.invoiceNumber,
          company: p.invoice?.billToName,
          amount: Number(p.amount),
          reference: p.reference,
          receivedAt: p.receivedAt,
        })),
      });
    }

    const rank = { critical: 0, warning: 1, info: 2 };
    alerts.sort((a, b) => rank[a.severity] - rank[b.severity]);

    res.json({
      alerts,
      summary: {
        total: alerts.length,
        critical: alerts.filter((a) => a.severity === 'critical').length,
        warning: alerts.filter((a) => a.severity === 'warning').length,
        info: alerts.filter((a) => a.severity === 'info').length,
      },
      thresholds: {
        expiryWarningDays: EXPIRY_WARNING_DAYS,
        stuckRegistrationDays: STUCK_REGISTRATION_DAYS,
      },
    });
  } catch (err) {
    next(err);
  }
}
