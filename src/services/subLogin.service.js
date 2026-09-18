import { prisma } from '../lib/prisma.js';
import {
  CAPABILITIES,
  REGISTRY_CAPABILITIES,
  SUBLOGIN_PRESETS,
  canGrantCapability,
  grantCapability,
  revokeCapability,
} from '../lib/capabilities.js';

/**
 * Sub-logins are NOT a separate kind of account.
 *
 * A sub-login is an ordinary TenantUser who holds one or more REGISTRY_*
 * capabilities. That means:
 *   - the existing invite flow (POST /api/employees) creates them, so duplicate
 *     handling, the temp password and the invite email keep working unchanged;
 *   - they appear in the employee directory like anyone else — no shadow list
 *     that can drift out of sync;
 *   - revoking their credentials does not delete the person.
 *
 * "Recruiter" and "Viewer" are labels for capability sets, never UserRole
 * values — writing them into `role` would fail the enum, and a role string like
 * that is exactly what caused the LEADERSHIP/normalizeRole escalation trap.
 */

/**
 * Describes what the capability set ALLOWS, in wording that cannot be mistaken
 * for a platform role.
 *
 * These deliberately avoid "Manager", "Recruiter" and "Viewer": those are the
 * names of the invite presets AND "Manager" is a real UserRole, so showing one
 * next to a person whose stored role is EMPLOYEE reads as though their role
 * changed. It never does — capabilities are additive.
 */
function describeAccess(capabilities) {
  const held = new Set(capabilities);
  const has = (c) => held.has(c);

  if (has(CAPABILITIES.REGISTRY_WRITE)) return 'Edit & Verify';
  if (has(CAPABILITIES.REGISTRY_EXPORT)) return 'Search & Export';
  if (has(CAPABILITIES.REGISTRY_SEARCH)) return 'Read-only';
  return 'No registry access';
}

export class SubLoginService {
  /** Presets for the "Platform Role Assignment" dropdown. */
  listPresets() {
    return Object.entries(SUBLOGIN_PRESETS).map(([key, p]) => ({
      key,
      label: p.label,
      role: p.role,
      capabilities: p.capabilities,
    }));
  }

  /**
   * Everyone in the tenant holding at least one registry capability, plus the
   * counters behind the three stat cards.
   */
  async list({ tenantId }) {
    const rows = await prisma.userCapability.findMany({
      where: {
        tenantId,
        capability: { in: REGISTRY_CAPABILITIES },
        user: { isDeleted: false },
      },
      select: {
        capability: true,
        title: true,
        createdAt: true,
        user: {
          select: {
            id: true, name: true, email: true, role: true, status: true,
            designation: true, department: true, createdAt: true,
          },
        },
      },
      orderBy: { createdAt: 'asc' },
    });

    // Collapse the per-capability rows into one entry per person.
    const byUser = new Map();
    for (const r of rows) {
      const existing = byUser.get(r.user.id);
      if (existing) {
        existing.capabilities.push(r.capability);
        if (!existing.title && r.title) existing.title = r.title;
      } else {
        byUser.set(r.user.id, {
          id: r.user.id,
          name: r.user.name,
          email: r.user.email,
          role: r.user.role,
          status: r.user.status,
          designation: r.user.designation,
          department: r.user.department,
          title: r.title || null,
          capabilities: [r.capability],
          grantedAt: r.createdAt,
        });
      }
    }

    const subLogins = [...byUser.values()].map((s) => ({
      ...s,
      // What their credentials allow (never a role name).
      accessLabel: describeAccess(s.capabilities),
      // The preset they were invited under — may differ from what they now hold.
      invitedAs: s.title,
    }));

    return {
      subLogins,
      stats: {
        // The three cards on the Sub-Logins page.
        authorized: subLogins.length,
        active: subLogins.filter((s) => s.status === 'ACTIVE').length,
        pending: subLogins.filter((s) => s.status === 'INVITED').length,
      },
    };
  }

  /**
   * Apply a capability set to an existing user, adding what is missing and
   * removing what was unticked. Every change is audited.
   */
  async applyCapabilities({ tenantId, actor, userId, capabilities, title }) {
    const requested = [...new Set(capabilities || [])];

    for (const cap of requested) {
      if (!REGISTRY_CAPABILITIES.includes(cap)) {
        throw Object.assign(new Error(`Unknown registry credential: ${cap}`), { status: 400 });
      }
      if (!canGrantCapability(actor, cap)) {
        throw Object.assign(
          new Error(`Your role cannot grant ${cap}`),
          { status: 403 },
        );
      }
    }

    const current = await prisma.userCapability.findMany({
      where: { tenantId, userId, capability: { in: REGISTRY_CAPABILITIES } },
      select: { capability: true },
    });
    const held = current.map((c) => c.capability);

    const toAdd = requested.filter((c) => !held.includes(c));
    const toRemove = held.filter((c) => !requested.includes(c));

    for (const cap of toRemove) {
      // Removing needs the same authority as granting.
      if (!canGrantCapability(actor, cap)) {
        throw Object.assign(new Error(`Your role cannot revoke ${cap}`), { status: 403 });
      }
    }

    for (const cap of toAdd) {
      await grantCapability({ tenantId, userId, capability: cap, title, grantedById: actor?.id, actor });
    }
    for (const cap of toRemove) {
      await revokeCapability({ tenantId, userId, capability: cap, actor });
    }

    return { added: toAdd, removed: toRemove, capabilities: requested };
  }

  /** Revoke every registry credential — the person and their account remain. */
  async revokeAll({ tenantId, actor, userId }) {
    return this.applyCapabilities({ tenantId, actor, userId, capabilities: [] });
  }

  /** The audit trail, newest first. */
  async listAudit({ tenantId, userId, limit = 100 }) {
    const rows = await prisma.capabilityAuditLog.findMany({
      where: { tenantId, ...(userId ? { targetUserId: userId } : {}) },
      orderBy: { createdAt: 'desc' },
      take: Math.min(Number(limit) || 100, 500),
      select: {
        id: true, action: true, capability: true, actorRole: true, createdAt: true,
        actor: { select: { id: true, name: true } },
        targetUser: { select: { id: true, name: true, email: true } },
      },
    });

    return rows.map((r) => ({
      id: r.id,
      action: r.action,
      capability: r.capability,
      at: r.createdAt,
      actor: r.actor ? { id: r.actor.id, name: r.actor.name, role: r.actorRole } : { id: null, name: 'Removed user', role: r.actorRole },
      target: r.targetUser,
    }));
  }
}

export default new SubLoginService();
