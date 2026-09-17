import { prisma } from './prisma.js';
import { ELEVATED_ROLES, hasRole } from './roles.js';

/**
 * capabilities.js
 *
 * Cross-cutting grants layered ON TOP of `TenantUser.role`.
 *
 * `role` is one value and encodes the HR hierarchy (roleHierarchy.js). Some
 * responsibilities do not fit there: a Chief People Officer is HR or EMPLOYEE
 * in HR terms AND sits on the leadership panel. Capabilities express that
 * second hat without disturbing the first.
 *
 * IMPORTANT: 'LEADERSHIP' must never be written into `TenantUser.role`.
 * `dashboardPermissions.normalizeRole()` maps that string to SUPER_ADMIN, so
 * doing so would silently grant every leader super-admin dashboard visibility.
 */

export const CAPABILITIES = {
  LEADERSHIP: 'LEADERSHIP',
};

export const ALL_CAPABILITIES = Object.values(CAPABILITIES);

/** Roles that may grant or revoke capabilities. */
export const CAPABILITY_ADMIN_ROLES = ['SUPER_ADMIN', 'ADMIN'];

/**
 * True when the request's user holds a capability.
 * Reads req.user.capabilities, which requireAuth loads fresh from the DB on
 * every request — so a revoked grant takes effect immediately rather than
 * lingering until a token expires.
 */
export function hasCapability(user, capability) {
  const list = user?.capabilities;
  return Array.isArray(list) && list.includes(capability);
}

/**
 * Leadership access: either an explicit grant, or an elevated role.
 *
 * Elevated roles are included because a SUPER_ADMIN/CMD locked out of the
 * leadership inbox until someone grants them a capability would be a
 * bootstrapping dead end — there would be nobody able to see the first message.
 */
export function isLeadership(user) {
  return hasCapability(user, CAPABILITIES.LEADERSHIP) || hasRole(user?.role, ELEVATED_ROLES);
}

export function canManageCapabilities(user) {
  return hasRole(user?.role, CAPABILITY_ADMIN_ROLES);
}

/** Capability strings held by one user. */
export async function loadCapabilities(userId) {
  if (!userId) return [];
  try {
    const rows = await prisma.userCapability.findMany({
      where: { userId },
      select: { capability: true },
    });
    return rows.map((r) => r.capability);
  } catch {
    // A failure here must not lock the user out of the whole app — they simply
    // get no extra grants beyond their role.
    return [];
  }
}

/**
 * Everyone in a tenant holding a capability, as a directory entry.
 * Used to populate "who can I write to" in CXO Connect.
 */
export async function listCapabilityHolders(tenantId, capability) {
  const rows = await prisma.userCapability.findMany({
    where: {
      tenantId,
      capability,
      user: { isDeleted: false, status: { not: 'EXITED' } },
    },
    select: {
      title: true,
      createdAt: true,
      user: {
        select: { id: true, name: true, email: true, role: true, designation: true, department: true },
      },
    },
    orderBy: { createdAt: 'asc' },
  });

  return rows.map((r) => ({
    id: r.user.id,
    name: r.user.name,
    email: r.user.email,
    role: r.user.role,
    // The grant's title wins — "Chief People Officer" is more meaningful to an
    // employee than the HR designation on the employment record.
    title: r.title || r.user.designation || null,
    department: r.user.department || null,
  }));
}

export async function grantCapability({ tenantId, userId, capability, title, grantedById }) {
  const user = await prisma.tenantUser.findFirst({
    where: { id: userId, tenantId, isDeleted: false },
    select: { id: true, name: true, status: true },
  });
  if (!user) {
    throw Object.assign(new Error('User not found in this organisation'), { status: 404 });
  }
  if (user.status === 'EXITED') {
    throw Object.assign(new Error('Cannot grant a capability to an exited user'), { status: 400 });
  }

  return prisma.userCapability.upsert({
    where: { userId_capability: { userId, capability } },
    update: { title: title ?? undefined },
    create: { tenantId, userId, capability, title: title ?? null, grantedById },
  });
}

export async function revokeCapability({ tenantId, userId, capability }) {
  const existing = await prisma.userCapability.findFirst({
    where: { userId, capability, tenantId },
    select: { id: true },
  });
  if (!existing) {
    throw Object.assign(new Error('That capability is not granted to this user'), { status: 404 });
  }
  await prisma.userCapability.delete({ where: { id: existing.id } });
  return { userId, capability };
}
