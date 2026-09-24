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
  REGISTRATION_LINK_RESENT: 'REGISTRATION_LINK_RESENT',
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

/**
 * Reads the trail, newest first. Actor names are resolved separately rather
 * than by relation, because actorId is not a foreign key — an audit row
 * outlives the account that created it, and must still render.
 */
export async function listPlatformAudit({ action, tenantId, page = 1, limit = 50 }) {
  const where = {
    ...(action ? { action } : {}),
    ...(tenantId ? { tenantId } : {}),
  };

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
    items: rows.map((r) => ({
      ...r,
      // A deleted operator still shows as an actor, by id, rather than vanishing.
      actor: actorById[r.actorId] || { id: r.actorId, name: 'Deleted account', email: null },
      // Null when the company has since been removed; the UI falls back to the id.
      tenantName: r.tenantId ? tenantById[r.tenantId] || null : null,
      // Null for TENANT-targeted rows, where the company name already says it.
      targetName: r.targetType === 'USER' ? (targetById[r.targetId]?.name || null) : null,
    })),
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) || 1 },
  };
}
