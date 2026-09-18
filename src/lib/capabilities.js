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
  // Registry / sub-login credentials — the checkboxes on the Invite Recruiter
  // modal. Capabilities rather than roles because "Recruiter" and "Viewer" are
  // not UserRole values, and a recruiter needs registry access without being
  // made an admin.
  REGISTRY_SEARCH: 'REGISTRY_SEARCH',
  REGISTRY_WRITE: 'REGISTRY_WRITE',
  REGISTRY_ANALYTICS: 'REGISTRY_ANALYTICS',
  REGISTRY_EXPORT: 'REGISTRY_EXPORT',
};

export const ALL_CAPABILITIES = Object.values(CAPABILITIES);

export const REGISTRY_CAPABILITIES = [
  CAPABILITIES.REGISTRY_SEARCH,
  CAPABILITIES.REGISTRY_WRITE,
  CAPABILITIES.REGISTRY_ANALYTICS,
  CAPABILITIES.REGISTRY_EXPORT,
];

/**
 * Who may grant each capability.
 *
 * HR can hand out registry credentials because HR already invites Managers and
 * Employees — blocking them would make the invite modal half-work. LEADERSHIP
 * stays with ADMIN/SUPER_ADMIN, since it decides who reads the CXO inbox.
 */
export const CAPABILITY_GRANT_ROLES = {
  [CAPABILITIES.LEADERSHIP]: ['SUPER_ADMIN', 'ADMIN'],
  [CAPABILITIES.REGISTRY_SEARCH]: ['SUPER_ADMIN', 'ADMIN', 'HR'],
  [CAPABILITIES.REGISTRY_WRITE]: ['SUPER_ADMIN', 'ADMIN', 'HR'],
  [CAPABILITIES.REGISTRY_ANALYTICS]: ['SUPER_ADMIN', 'ADMIN', 'HR'],
  [CAPABILITIES.REGISTRY_EXPORT]: ['SUPER_ADMIN', 'ADMIN', 'HR'],
};

/** Roles that may grant or revoke at least one capability. */
export const CAPABILITY_ADMIN_ROLES = ['SUPER_ADMIN', 'ADMIN', 'HR'];

/** True when this user may grant/revoke this specific capability. */
export function canGrantCapability(user, capability) {
  const allowed = CAPABILITY_GRANT_ROLES[capability];
  return Array.isArray(allowed) && hasRole(user?.role, allowed);
}

/**
 * Presets behind the "Platform Role Assignment" dropdown.
 *
 * The preset only seeds the checkboxes — the capabilities actually sent are the
 * source of truth, so a preset and a hand-ticked set never disagree.
 * `role` is a real UserRole value; "Recruiter" and "Viewer" deliberately are not.
 */
export const SUBLOGIN_PRESETS = {
  RECRUITER: {
    label: 'Recruiter (Search focused)',
    role: 'EMPLOYEE',
    capabilities: [CAPABILITIES.REGISTRY_SEARCH, CAPABILITIES.REGISTRY_EXPORT],
  },
  MANAGER: {
    label: 'Manager (Edit and Verify)',
    role: 'MANAGER',
    capabilities: [
      CAPABILITIES.REGISTRY_SEARCH,
      CAPABILITIES.REGISTRY_WRITE,
      CAPABILITIES.REGISTRY_ANALYTICS,
      CAPABILITIES.REGISTRY_EXPORT,
    ],
  },
  VIEWER: {
    // Read-only: can look, cannot take the data away. That export line is what
    // separates a Viewer from a Recruiter.
    label: 'Viewer (Read-only search)',
    role: 'EMPLOYEE',
    capabilities: [CAPABILITIES.REGISTRY_SEARCH],
  },
};

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

/** Convenience for the registry gates: role-based access OR an explicit grant. */
export function canSearchRegistry(user) {
  return (
    hasCapability(user, CAPABILITIES.REGISTRY_SEARCH) ||
    hasRole(user?.role, ['SUPER_ADMIN', 'ADMIN', 'CMD', 'HR', 'FINANCE'])
  );
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

async function writeAudit({ tenantId, action, capability, targetUserId, actor, title }) {
  try {
    await prisma.capabilityAuditLog.create({
      data: {
        tenantId,
        action,
        capability,
        targetUserId,
        actorId: actor?.id ?? null,
        actorRole: actor?.role ?? null,
        title: title ?? null,
      },
    });
  } catch (err) {
    // The audit write must never block the grant itself, but a failure here is
    // worth shouting about — it means access changed without a record.
    console.error('[capabilities] AUDIT WRITE FAILED', { action, capability, targetUserId }, err.message);
  }
}

export async function grantCapability({ tenantId, userId, capability, title, grantedById, actor }) {
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

  const existing = await prisma.userCapability.findUnique({
    where: { userId_capability: { userId, capability } },
    select: { id: true },
  });

  const row = await prisma.userCapability.upsert({
    where: { userId_capability: { userId, capability } },
    update: { title: title ?? undefined },
    create: { tenantId, userId, capability, title: title ?? null, grantedById },
  });

  // Only log a real widening of access, not a title edit on an existing grant.
  if (!existing) {
    await writeAudit({ tenantId, action: 'GRANT', capability, targetUserId: userId, actor, title });
  }
  return row;
}

export async function revokeCapability({ tenantId, userId, capability, actor }) {
  const existing = await prisma.userCapability.findFirst({
    where: { userId, capability, tenantId },
    select: { id: true },
  });
  if (!existing) {
    throw Object.assign(new Error('That capability is not granted to this user'), { status: 404 });
  }
  await prisma.userCapability.delete({ where: { id: existing.id } });
  await writeAudit({ tenantId, action: 'REVOKE', capability, targetUserId: userId, actor });
  return { userId, capability };
}
