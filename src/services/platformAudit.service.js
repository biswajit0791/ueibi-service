import { prisma } from '../lib/prisma.js';

/**
 * Records what the platform operator did.
 *
 * The five existing audit models (task, goal, leave, policy, capability) are
 * all tenant-scoped: they record what happens INSIDE a company. None of them
 * record what the operator does TO a company. This is that trail, and every
 * platform mutation must write one row.
 *
 * Reads are deliberately not audited — logging every page view would bury the
 * handful of entries that matter.
 */

/** Action names, kept as constants so a typo cannot silently create a new one. */
export const PLATFORM_ACTIONS = {
  TENANT_SUSPENDED: 'TENANT_SUSPENDED',
  TENANT_RESTORED: 'TENANT_RESTORED',
  COUPON_CREATED: 'COUPON_CREATED',
  COUPON_UPDATED: 'COUPON_UPDATED',
  COUPON_DEACTIVATED: 'COUPON_DEACTIVATED',
  COUPON_DELETED: 'COUPON_DELETED',
  TENANT_LIFECYCLE_CHANGED: 'TENANT_LIFECYCLE_CHANGED',
  TENANT_LICENCES_CHANGED: 'TENANT_LICENCES_CHANGED',
  USER_DEACTIVATED: 'USER_DEACTIVATED',
  USER_REACTIVATED: 'USER_REACTIVATED',
  USER_PASSWORD_RESET_SENT: 'USER_PASSWORD_RESET_SENT',
  USER_2FA_ENABLED: 'USER_2FA_ENABLED',
  USER_2FA_DISABLED: 'USER_2FA_DISABLED',
  USER_BLOCKED: 'USER_BLOCKED',
  USER_UNBLOCKED: 'USER_UNBLOCKED',
  SESSION_TERMINATED: 'SESSION_TERMINATED',
  STAFF_CREATED: 'STAFF_CREATED',
  REGISTRATION_LINK_RESENT: 'REGISTRATION_LINK_RESENT',
  REGISTRATION_RECIPIENT_EMAIL_UPDATED: 'REGISTRATION_RECIPIENT_EMAIL_UPDATED',
  REGISTRATION_VERIFIED: 'REGISTRATION_VERIFIED',
  // Billing. Everything that moves money or a contract is recorded.
  PACKAGE_CREATED: 'PACKAGE_CREATED',
  PACKAGE_UPDATED: 'PACKAGE_UPDATED',
  PACKAGE_DELETED: 'PACKAGE_DELETED',
  SUBSCRIPTION_STARTED: 'SUBSCRIPTION_STARTED',
  SUBSCRIPTION_RENEWED: 'SUBSCRIPTION_RENEWED',
  SUBSCRIPTION_CANCELLED: 'SUBSCRIPTION_CANCELLED',
  INVOICE_CREATED: 'INVOICE_CREATED',
  INVOICE_ISSUED: 'INVOICE_ISSUED',
  INVOICE_VOIDED: 'INVOICE_VOIDED',
  INVOICE_SENT: 'INVOICE_SENT',
  PAYMENT_RECORDED: 'PAYMENT_RECORDED',
  REFUND_RECORDED: 'REFUND_RECORDED',
  // Legal documents. Publishing changes what new customers agree to, so it is
  // recorded with the version number on both sides.
  LEGAL_DOCUMENT_CREATED: 'LEGAL_DOCUMENT_CREATED',
  LEGAL_DOCUMENT_UPDATED: 'LEGAL_DOCUMENT_UPDATED',
  LEGAL_VERSION_PUBLISHED: 'LEGAL_VERSION_PUBLISHED',
  LEGAL_DOCUMENT_DELETED: 'LEGAL_DOCUMENT_DELETED',
  // Invoice templates. Publishing changes how new invoices look, so it is
  // recorded with the version number on both sides.
  INVOICE_TEMPLATE_CREATED: 'INVOICE_TEMPLATE_CREATED',
  INVOICE_TEMPLATE_UPDATED: 'INVOICE_TEMPLATE_UPDATED',
  INVOICE_TEMPLATE_PUBLISHED: 'INVOICE_TEMPLATE_PUBLISHED',
  INVOICE_TEMPLATE_DELETED: 'INVOICE_TEMPLATE_DELETED',
  INVOICE_SETTINGS_UPDATED: 'INVOICE_SETTINGS_UPDATED',
  BRANDING_UPDATED: 'BRANDING_UPDATED',
  ORGANIZATION_STRUCTURE_CREATED: 'ORGANIZATION_STRUCTURE_CREATED',
  ORGANIZATION_STRUCTURE_UPDATED: 'ORGANIZATION_STRUCTURE_UPDATED',
  ORGANIZATION_STRUCTURE_STATUS_CHANGED: 'ORGANIZATION_STRUCTURE_STATUS_CHANGED',
  ORGANIZATION_STRUCTURE_DELETED: 'ORGANIZATION_STRUCTURE_DELETED',
  DESIGNATION_CREATED: 'DESIGNATION_CREATED',
  DESIGNATION_UPDATED: 'DESIGNATION_UPDATED',
  DESIGNATION_STATUS_CHANGED: 'DESIGNATION_STATUS_CHANGED',
  DESIGNATION_DELETED: 'DESIGNATION_DELETED',
};

/**
 * Best-effort client IP. Trusts x-forwarded-for because the app sits behind
 * nginx in production; the value is informational for the trail, never used
 * for an authorization decision.
 */
function ipOf(req) {
  const fwd = req.headers?.['x-forwarded-for'];
  if (typeof fwd === 'string' && fwd.trim()) return fwd.split(',')[0].trim();
  return req.ip || req.socket?.remoteAddress || null;
}

/**
 * Writes one audit row.
 *
 * Failure to audit must not silently succeed the action it describes, so this
 * throws rather than swallowing. Callers write the audit row inside the same
 * transaction as the mutation where possible, so the two cannot diverge.
 *
 * @param {object} args
 * @param {object} [args.tx] - a Prisma transaction client; falls back to prisma
 */
export async function recordPlatformAction({
  tx,
  req,
  action,
  targetType,
  targetId = null,
  tenantId = null,
  beforeValue = null,
  afterValue = null,
  reason = null,
}) {
  const client = tx || prisma;
  return client.platformAuditLog.create({
    data: {
      actorId: req.user.id,
      action,
      targetType,
      targetId,
      tenantId,
      beforeValue: beforeValue ?? undefined,
      afterValue: afterValue ?? undefined,
      reason,
      ipAddress: ipOf(req),
    },
  });
}

export const PLATFORM_MENUS = {
  companies: { key: 'companies', label: 'Companies' },
  users: { key: 'users', label: 'Users' },
  login_history: { key: 'login_history', label: 'Login History & Usage' },
  internal_team: { key: 'internal_team', label: 'Internal Team' },
  signup_data: { key: 'signup_data', label: 'Sign-up Data' },
  registration_settings: { key: 'registration_settings', label: 'Billing Settings' },
  master_data: { key: 'master_data', label: 'Master Data Management' },
  onboarding: { key: 'onboarding', label: 'Onboarding' },
  verification: { key: 'verification', label: 'Verification' },
  packages: { key: 'packages', label: 'Packages' },
  renewal: { key: 'renewal', label: 'Renewal' },
  invoices: { key: 'invoices', label: 'Invoices' },
  bdm_coupons: { key: 'bdm_coupons', label: 'BDM Coupons' },
  customer_reviews: { key: 'customer_reviews', label: 'Testimonial' },
  testimonials: { key: 'customer_reviews', label: 'Testimonial' },
  invoice_design: { key: 'invoice_design', label: 'Invoice Design' },
  invoice_settings: { key: 'invoice_settings', label: 'Invoice Settings' },
  brand_logo: { key: 'brand_logo', label: 'Brand & Logo' },
  legal: { key: 'legal', label: 'Legal' },
};

/**
 * Maps an audit log's action and targetType to the corresponding Platform Owner navigation menu.
 */
export function resolveAuditMenu(record) {
  if (!record) return { key: 'system', label: 'Platform System' };

  // 1. Explicit menu/module in metadata
  const metaMenu = record.afterValue?.menu || record.beforeValue?.menu || record.afterValue?.module || record.beforeValue?.module;
  if (metaMenu) {
    const normalized = String(metaMenu).toLowerCase().replace(/[-\s]/g, '_');
    if (PLATFORM_MENUS[normalized]) return PLATFORM_MENUS[normalized];
    return { key: normalized, label: String(metaMenu) };
  }

  const action = String(record.action || '').toUpperCase();
  const targetType = String(record.targetType || '').toUpperCase();

  // 2. Master Data Management
  if (
    ['CITYMASTER', 'INDUSTRYMASTER', 'SUBSCRIPTIONDURATIONMASTER', 'MASTER_DATA', 'MASTERDATA'].includes(targetType) ||
    action.startsWith('CITY_') ||
    action.startsWith('INDUSTRY_') ||
    action.startsWith('SUBSCRIPTION_DURATION_') ||
    action.startsWith('MASTER_DATA_')
  ) {
    return PLATFORM_MENUS.master_data;
  }

  // 3. BDM Coupons
  if (targetType === 'COUPON' || action.startsWith('COUPON_')) {
    return PLATFORM_MENUS.bdm_coupons;
  }

  // 4. Companies
  if (
    targetType === 'TENANT' ||
    ['TENANT_SUSPENDED', 'TENANT_RESTORED', 'TENANT_LIFECYCLE_CHANGED', 'TENANT_LICENCES_CHANGED', 'AUTOMATIC_TENANT_ACTIVATION', 'TENANT_DELETED'].includes(action)
  ) {
    return PLATFORM_MENUS.companies;
  }

  // 5. Internal Team / Staff / Roles & Designation
  if (
    ['STAFF', 'STAFF_MEMBER', 'ORGANIZATIONSTRUCTURE', 'DESIGNATION'].includes(targetType) ||
    action.startsWith('STAFF_') ||
    action.startsWith('ORGANIZATION_STRUCTURE_') ||
    action.startsWith('DESIGNATION_') ||
    action === 'PLATFORM_STAFF_PERMISSIONS_UPDATED'
  ) {
    return PLATFORM_MENUS.internal_team;
  }

  // 6. Users & Login History
  if (action === 'USER_BLOCKED' || action === 'USER_UNBLOCKED' || action === 'SESSION_TERMINATED' || targetType === 'USER_SESSION') {
    return PLATFORM_MENUS.login_history;
  }

  if (
    targetType === 'USER' ||
    action.startsWith('USER_') ||
    ['USER_DEACTIVATED', 'USER_REACTIVATED', 'USER_PASSWORD_RESET_SENT', 'USER_2FA_ENABLED', 'USER_2FA_DISABLED'].includes(action)
  ) {
    return PLATFORM_MENUS.users;
  }

  // 7. Onboarding & Verification & Sign-up Data
  if (targetType === 'REGISTRATION') {
    if (action === 'REGISTRATION_VERIFIED' || action === 'CHEQUE_CONFIRMED') {
      return PLATFORM_MENUS.verification;
    }
    if (action === 'REGISTRATION_DELETED' || action === 'REGISTRATION_LINK_RESENT') {
      return PLATFORM_MENUS.signup_data;
    }
    if (action === 'PAYMENT_CONFIRMED' || action === 'PAYMENT_REFUNDED') {
      return PLATFORM_MENUS.onboarding;
    }
    return PLATFORM_MENUS.onboarding;
  }
  if (targetType === 'VERIFICATION') return PLATFORM_MENUS.verification;
  if (targetType === 'SIGNUP_DATA') return PLATFORM_MENUS.signup_data;

  // 8. Billing & Invoices
  if (targetType === 'INVOICE_SETTINGS' || action.startsWith('INVOICE_SETTINGS_')) {
    return PLATFORM_MENUS.invoice_settings;
  }
  if (targetType === 'INVOICE_TEMPLATE' || action.startsWith('INVOICE_TEMPLATE_')) {
    return PLATFORM_MENUS.invoice_design;
  }
  if (
    targetType === 'INVOICE' ||
    targetType === 'PAYMENT' ||
    targetType === 'REFUND' ||
    action.startsWith('INVOICE_') ||
    action === 'PAYMENT_RECORDED' ||
    action === 'REFUND_RECORDED'
  ) {
    return PLATFORM_MENUS.invoices;
  }

  // 9. Packages
  if (targetType === 'PACKAGE' || action.startsWith('PACKAGE_')) {
    return PLATFORM_MENUS.packages;
  }

  // 10. Renewal / Subscriptions
  if (targetType === 'SUBSCRIPTION' || action.startsWith('SUBSCRIPTION_')) {
    return PLATFORM_MENUS.renewal;
  }

  // 11. Legal Documents
  if (targetType === 'LEGAL_DOCUMENT' || action.startsWith('LEGAL_')) {
    return PLATFORM_MENUS.legal;
  }

  // 12. Brand & Logo
  if (targetType === 'BRANDING' || action.startsWith('BRANDING_')) {
    return PLATFORM_MENUS.brand_logo;
  }

  // 13. Billing Settings / Registration Settings / Promotions
  if (
    ['SETTING', 'SETTINGS', 'REGISTRATION_SETTINGS', 'PROMOTION'].includes(targetType) ||
    action.startsWith('SETTING_') ||
    action.startsWith('BILLING_SETTINGS_') ||
    action.startsWith('PROMOTION_')
  ) {
    return PLATFORM_MENUS.registration_settings;
  }

  return { key: 'system', label: 'Platform System' };
}

/**
 * Builds Prisma query filter corresponding to a Platform Owner navigation menu key.
 */
export function getPrismaWhereForMenu(menuKey) {
  if (!menuKey) return null;
  const key = String(menuKey).toLowerCase().replace(/[-\s]/g, '_');
  switch (key) {
    case 'master_data':
      return {
        OR: [
          { targetType: { in: ['CityMaster', 'IndustryMaster', 'SubscriptionDurationMaster', 'MASTER_DATA', 'MASTERDATA'] } },
          { action: { startsWith: 'CITY_' } },
          { action: { startsWith: 'INDUSTRY_' } },
          { action: { startsWith: 'SUBSCRIPTION_DURATION_' } },
          { action: { startsWith: 'MASTER_DATA_' } },
        ],
      };
    case 'bdm_coupons':
    case 'coupons':
      return {
        OR: [
          { targetType: 'COUPON' },
          { action: { startsWith: 'COUPON_' } },
        ],
      };
    case 'companies':
      return {
        OR: [
          { targetType: 'TENANT' },
          { action: { in: ['TENANT_SUSPENDED', 'TENANT_RESTORED', 'TENANT_LIFECYCLE_CHANGED', 'TENANT_LICENCES_CHANGED', 'AUTOMATIC_TENANT_ACTIVATION', 'TENANT_DELETED'] } },
        ],
      };
    case 'users':
      return {
        OR: [
          {
            AND: [
              { targetType: 'USER' },
              { action: { in: ['USER_DEACTIVATED', 'USER_REACTIVATED', 'USER_PASSWORD_RESET_SENT', 'USER_2FA_ENABLED', 'USER_2FA_DISABLED'] } },
            ],
          },
          { action: { startsWith: 'USER_' } },
        ],
      };
    case 'login_history':
    case 'login_history_usage':
    case 'usage':
      return {
        OR: [
          { targetType: 'USER_SESSION' },
          { action: { in: ['USER_BLOCKED', 'USER_UNBLOCKED', 'SESSION_TERMINATED'] } },
        ],
      };
    case 'internal_team':
    case 'staff':
      return {
        OR: [
          { targetType: { in: ['STAFF', 'STAFF_MEMBER', 'OrganizationStructure', 'Designation'] } },
          { action: { startsWith: 'STAFF_' } },
          { action: { startsWith: 'ORGANIZATION_STRUCTURE_' } },
          { action: { startsWith: 'DESIGNATION_' } },
          { action: 'PLATFORM_STAFF_PERMISSIONS_UPDATED' },
        ],
      };
    case 'packages':
      return {
        OR: [
          { targetType: 'PACKAGE' },
          { action: { startsWith: 'PACKAGE_' } },
        ],
      };
    case 'renewal':
    case 'subscriptions':
      return {
        OR: [
          { targetType: 'SUBSCRIPTION' },
          { action: { startsWith: 'SUBSCRIPTION_' } },
        ],
      };
    case 'invoices':
      return {
        OR: [
          { targetType: { in: ['INVOICE', 'PAYMENT', 'REFUND'] } },
          {
            AND: [
              { action: { startsWith: 'INVOICE_' } },
              { action: { not: { startsWith: 'INVOICE_SETTINGS_' } } },
              { action: { not: { startsWith: 'INVOICE_TEMPLATE_' } } },
            ],
          },
          { action: { in: ['PAYMENT_RECORDED', 'REFUND_RECORDED'] } },
        ],
      };
    case 'invoice_settings':
      return {
        OR: [
          { targetType: 'INVOICE_SETTINGS' },
          { action: { startsWith: 'INVOICE_SETTINGS_' } },
        ],
      };
    case 'invoice_design':
      return {
        OR: [
          { targetType: 'INVOICE_TEMPLATE' },
          { action: { startsWith: 'INVOICE_TEMPLATE_' } },
        ],
      };
    case 'legal':
      return {
        OR: [
          { targetType: 'LEGAL_DOCUMENT' },
          { action: { startsWith: 'LEGAL_' } },
        ],
      };
    case 'customer_reviews':
    case 'testimonial':
    case 'testimonials':
    case 'reviews':
      return {
        OR: [
          { targetType: { in: ['REVIEW', 'TESTIMONIAL', 'CUSTOMER_REVIEW'] } },
          { action: { startsWith: 'REVIEW_' } },
          { action: { startsWith: 'TESTIMONIAL_' } },
        ],
      };
    case 'brand_logo':
    case 'branding':
      return {
        OR: [
          { targetType: 'BRANDING' },
          { action: { startsWith: 'BRANDING_' } },
        ],
      };
    case 'registration_settings':
    case 'billing_settings':
      return {
        OR: [
          { targetType: { in: ['SETTING', 'SETTINGS', 'REGISTRATION_SETTINGS', 'PROMOTION'] } },
          { action: { startsWith: 'SETTING_' } },
          { action: { startsWith: 'BILLING_SETTINGS_' } },
          { action: { startsWith: 'PROMOTION_' } },
        ],
      };
    case 'onboarding':
      return {
        AND: [
          { targetType: 'REGISTRATION' },
          { action: { in: ['PAYMENT_CONFIRMED', 'PAYMENT_REFUNDED'] } },
        ],
      };
    case 'verification':
      return {
        OR: [
          { targetType: 'VERIFICATION' },
          {
            AND: [
              { targetType: 'REGISTRATION' },
              { action: { in: ['REGISTRATION_VERIFIED', 'CHEQUE_CONFIRMED'] } },
            ],
          },
        ],
      };
    case 'signup_data':
      return {
        OR: [
          { targetType: 'SIGNUP_DATA' },
          {
            AND: [
              { targetType: 'REGISTRATION' },
              { action: { in: ['REGISTRATION_DELETED', 'REGISTRATION_LINK_RESENT'] } },
            ],
          },
        ],
      };
    default:
      return null;
  }
}

/**
 * Reads the trail, newest first. Actor names are resolved separately rather
 * than by relation, because actorId is not a foreign key — an audit row
 * outlives the account that created it, and must still render.
 */
export async function listPlatformAudit({
  action,
  tenantId,
  menu,
  search,
  fromDate,
  toDate,
  startDate,
  endDate,
  page = 1,
  limit = 50,
}) {
  const whereConditions = [];

  if (action) {
    whereConditions.push({ action });
  }

  if (tenantId) {
    whereConditions.push({ tenantId });
  }

  // Menu-wise filtering
  if (menu) {
    const menuFilter = getPrismaWhereForMenu(menu);
    if (menuFilter) {
      whereConditions.push(menuFilter);
    }
  }

  // Date range filtering (From Date & To Date) with robust boundary coverage
  const from = fromDate || startDate;
  const to = toDate || endDate;
  let fromTime = null;
  let toTime = null;

  if (from) {
    const d = new Date(from);
    if (!isNaN(d.getTime())) {
      d.setHours(0, 0, 0, 0);
      fromTime = d;
    }
  }

  if (to) {
    const d = new Date(to);
    if (!isNaN(d.getTime())) {
      d.setHours(23, 59, 59, 999);
      toTime = d;
    }
  }

  if (fromTime || toTime) {
    whereConditions.push({
      createdAt: {
        ...(fromTime ? { gte: fromTime } : {}),
        ...(toTime ? { lte: toTime } : {}),
      },
    });
  }

  // Backend search across action, reason, targetType, ipAddress, matched tenant & actor
  if (search && String(search).trim()) {
    const q = String(search).trim();
    let matchedTenantIds = [];
    let matchedActorIds = [];

    try {
      const [tenants, actors] = await Promise.all([
        prisma.tenant.findMany({
          where: { companyName: { contains: q, mode: 'insensitive' } },
          select: { id: true },
          take: 50,
        }),
        prisma.tenantUser.findMany({
          where: {
            OR: [
              { name: { contains: q, mode: 'insensitive' } },
              { email: { contains: q, mode: 'insensitive' } },
            ],
          },
          select: { id: true },
          take: 50,
        }),
      ]);
      matchedTenantIds = tenants.map((t) => t.id);
      matchedActorIds = actors.map((a) => a.id);
    } catch {
      // Non-fatal if relations search fails
    }

    const orClauses = [
      { reason: { contains: q, mode: 'insensitive' } },
      { action: { contains: q, mode: 'insensitive' } },
      { targetType: { contains: q, mode: 'insensitive' } },
      { ipAddress: { contains: q, mode: 'insensitive' } },
    ];

    if (matchedTenantIds.length > 0) {
      orClauses.push({ tenantId: { in: matchedTenantIds } });
    }
    if (matchedActorIds.length > 0) {
      orClauses.push({ actorId: { in: matchedActorIds } });
    }

    whereConditions.push({ OR: orClauses });
  }

  const where = whereConditions.length === 0
    ? {}
    : whereConditions.length === 1
      ? whereConditions[0]
      : { AND: whereConditions };

  const [total, rows] = await Promise.all([
    prisma.platformAuditLog.count({ where }),
    prisma.platformAuditLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
    }),
  ]);

  const actorIds = [...new Set(rows.map((r) => r.actorId))];
  const actors = actorIds.length
    ? await prisma.tenantUser.findMany({
        where: { id: { in: actorIds } },
        select: { id: true, name: true, email: true },
      })
    : [];
  const actorById = Object.fromEntries(actors.map((a) => [a.id, a]));

  // Company names are resolved the same way and for the same reason: the row
  // stores an id so it survives the company being deleted, but a raw cuid is
  // unreadable in a trail meant to be reviewed months later.
  const tenantIds = [...new Set(rows.map((r) => r.tenantId).filter(Boolean))];
  const tenants = tenantIds.length
    ? await prisma.tenant.findMany({
        where: { id: { in: tenantIds } },
        select: { id: true, companyName: true },
      })
    : [];
  const tenantById = Object.fromEntries(tenants.map((t) => [t.id, t.companyName]));

  // User-targeted actions (deactivations, resets) record only the target's id.
  // Without this the trail says a company had *someone* deactivated, which is
  // not something anyone can review. Same by-id lookup, same survival property.
  const userTargetIds = [...new Set(
    rows.filter((r) => r.targetType === 'USER').map((r) => r.targetId).filter(Boolean),
  )];
  const targetUsers = userTargetIds.length
    ? await prisma.tenantUser.findMany({
        where: { id: { in: userTargetIds } },
        select: { id: true, name: true, email: true },
      })
    : [];
  const targetById = Object.fromEntries(targetUsers.map((u) => [u.id, u]));

  return {
    items: rows.map((r) => {
      const menuObj = resolveAuditMenu(r);
      return {
        ...r,
        menu: menuObj.key,
        menuLabel: menuObj.label,
        menuInfo: menuObj,
        // A deleted operator still shows as an actor, by id, rather than vanishing.
        actor: actorById[r.actorId] || { id: r.actorId, name: 'Deleted account', email: null },
        // Null when the company has since been removed; the UI falls back to the id.
        tenantName: r.tenantId ? tenantById[r.tenantId] || null : null,
        // Null for TENANT-targeted rows, where the company name already says it.
        targetName: r.targetType === 'USER' ? (targetById[r.targetId]?.name || null) : null,
      };
    }),
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) || 1 },
  };
}
