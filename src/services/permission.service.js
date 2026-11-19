import { prisma } from '../lib/prisma.js';
import {
  PERMISSIONS_CATALOG,
  ROLE_PERMISSION_CEILINGS,
  DEFAULT_ACCESS_PROFILES,
  PERMISSION_MODULES,
} from '../lib/permissionsCatalog.js';

/**
 * 1. Idempotently seed the global permissions catalog into database.
 */
export async function ensurePermissionsCatalogSeeded() {
  try {
    for (const item of PERMISSIONS_CATALOG) {
      await prisma.permission.upsert({
        where: { key: item.key },
        create: {
          key: item.key,
          name: item.name,
          module: item.module,
          category: item.category,
          action: item.action,
          description: item.description,
          sortOrder: item.sortOrder || 0,
        },
        update: {
          name: item.name,
          module: item.module,
          category: item.category,
          action: item.action,
          description: item.description,
          sortOrder: item.sortOrder || 0,
        },
      });
    }
  } catch (err) {
    console.error('[permission.service] Error seeding permissions catalog:', err.message);
  }
}

/**
 * 2. Ensure enterprise default access profiles exist for a given tenant.
 */
export async function ensureTenantDefaultProfiles(tenantId) {
  if (!tenantId) return;
  try {
    // Seed global permissions first
    await ensurePermissionsCatalogSeeded();

    for (const defProfile of DEFAULT_ACCESS_PROFILES) {
      let profile = await prisma.accessProfile.findFirst({
        where: {
          tenantId,
          role: defProfile.role,
          name: defProfile.name,
        },
      });

      if (!profile) {
        profile = await prisma.accessProfile.create({
          data: {
            tenantId,
            name: defProfile.name,
            role: defProfile.role,
            description: defProfile.description,
            isDefault: defProfile.isDefault || false,
          },
        });

        // Insert profile permissions
        const permEntries = Object.entries(defProfile.permissions || {});
        for (const [permKey, accessType] of permEntries) {
          await prisma.accessProfilePermission.upsert({
            where: {
              profileId_permissionKey: {
                profileId: profile.id,
                permissionKey: permKey,
              },
            },
            create: {
              profileId: profile.id,
              permissionKey: permKey,
              accessType: accessType || 'ALLOW',
            },
            update: {
              accessType: accessType || 'ALLOW',
            },
          });
        }
      }
    }
  } catch (err) {
    console.error(`[permission.service] Error ensuring default profiles for tenant ${tenantId}:`, err.message);
  }
}

/**
 * 3. Recursive helper to fetch all employee IDs in a manager's reporting tree downline.
 */
export async function getReportingDownlineUserIds(tenantId, managerId) {
  if (!tenantId || !managerId) return [];
  const downline = new Set();
  const queue = [managerId];

  while (queue.length > 0) {
    const currentId = queue.shift();
    const directs = await prisma.tenantUser.findMany({
      where: {
        tenantId,
        managerId: currentId,
        isDeleted: false,
      },
      select: { id: true },
    });

    for (const d of directs) {
      if (!downline.has(d.id)) {
        downline.add(d.id);
        queue.push(d.id);
      }
    }
  }

  return Array.from(downline);
}

/**
 * 4. Get Effective Permissions for a User.
 *
 * Implements the 3-Layer Authorization Architecture:
 * - Layer 1: Role-Based Permission Ceiling (Absolute ceiling)
 * - Layer 2: Individual User Permissions & Access Profile (Explicit overrides)
 * - Layer 3: Data-Level Access Scopes
 *
 * Precedence Rule:
 * Role Ceiling &cap; (Explicit Overrides + Access Profile + Role Baseline)
 * Explicit DENY always overrides ALLOW.
 */
export async function getEffectiveUserPermissions(tenantId, userId) {
  if (!tenantId || !userId) {
    throw new Error('tenantId and userId are required');
  }

  // 1. Fetch user
  const user = await prisma.tenantUser.findFirst({
    where: { id: userId, tenantId, isDeleted: false },
    include: {
      accessProfile: {
        include: {
          accessProfilePermissions: true,
        },
      },
      userPermissions: true,
      dataScope: true,
      manager: {
        select: { id: true, name: true, email: true, employeeId: true },
      },
    },
  });

  if (!user) {
    throw new Error('User not found or deleted');
  }

  // 2. Fetch tenant custom role ceilings (if stored in database or fallback to ROLE_PERMISSION_CEILINGS)
  const tenantRolePerms = await prisma.rolePermission.findMany({
    where: {
      OR: [{ tenantId, role: user.role }, { tenantId: null, role: user.role }],
    },
  });

  const roleConfig = ROLE_PERMISSION_CEILINGS[user.role] || {
    ceiling: [],
    defaults: [],
  };

  // Ceiling set: if tenant has configured custom ceilings in DB, use them, otherwise use ROLE_PERMISSION_CEILINGS
  const roleCeilingSet = new Set(
    tenantRolePerms.length > 0
      ? tenantRolePerms.filter((rp) => rp.isCeiling).map((rp) => rp.permissionKey)
      : roleConfig.ceiling
  );

  const roleDefaultsSet = new Set(
    tenantRolePerms.length > 0
      ? tenantRolePerms.filter((rp) => rp.isAllowed).map((rp) => rp.permissionKey)
      : roleConfig.defaults
  );

  // 3. User overrides map
  const userOverridesMap = new Map();
  for (const up of user.userPermissions || []) {
    userOverridesMap.set(up.permissionKey, up.accessType); // 'ALLOW' | 'DENY'
  }

  // 4. Access profile permissions map
  const profilePermissionsMap = new Map();
  if (user.accessProfile && user.accessProfile.accessProfilePermissions) {
    for (const app of user.accessProfile.accessProfilePermissions) {
      profilePermissionsMap.set(app.permissionKey, app.accessType); // 'ALLOW' | 'DENY'
    }
  }

  // 5. Compute effective permissions for all catalog items
  const effectivePermissions = {};
  let totalAllowed = 0;
  let totalOverrides = userOverridesMap.size;

  for (const catalogItem of PERMISSIONS_CATALOG) {
    const permKey = catalogItem.key;
    const isWithinCeiling = roleCeilingSet.has(permKey);

    let allowed = false;
    let source = 'ROLE_DEFAULT';
    let inheritedValue = roleDefaultsSet.has(permKey);

    if (user.accessProfile && profilePermissionsMap.has(permKey)) {
      inheritedValue = profilePermissionsMap.get(permKey) === 'ALLOW';
      source = `PROFILE (${user.accessProfile.name})`;
    }

    if (!isWithinCeiling) {
      // Exceeds role ceiling: cannot be granted
      allowed = false;
      source = 'CEILING_RESTRICTED';
    } else if (userOverridesMap.has(permKey)) {
      // User individual override
      const overrideType = userOverridesMap.get(permKey);
      if (overrideType === 'DENY') {
        allowed = false;
        source = 'USER_OVERRIDE (DENY)';
      } else {
        allowed = true;
        source = 'USER_OVERRIDE (ALLOW)';
      }
    } else if (user.accessProfile && profilePermissionsMap.has(permKey)) {
      // Inherited from Access Profile
      const profType = profilePermissionsMap.get(permKey);
      if (profType === 'DENY') {
        allowed = false;
        source = `PROFILE [${user.accessProfile.name}] (DENY)`;
      } else {
        allowed = true;
        source = `PROFILE [${user.accessProfile.name}] (ALLOW)`;
      }
    } else {
      // Fallback to role baseline
      allowed = roleDefaultsSet.has(permKey);
      source = allowed ? 'ROLE_DEFAULT' : 'ROLE_RESTRICTED';
    }

    if (allowed) totalAllowed++;

    effectivePermissions[permKey] = {
      key: permKey,
      name: catalogItem.name,
      module: catalogItem.module,
      category: catalogItem.category,
      action: catalogItem.action,
      description: catalogItem.description,
      isWithinCeiling,
      isCeilingProtected: !isWithinCeiling,
      inheritedValue,
      allowed,
      source,
      userOverride: userOverridesMap.get(permKey) || null,
    };
  }

  // 6. Data-Level Access Scope
  // Default scopes:
  // SUPER_ADMIN, ADMIN, CMD, HR: ALL
  // MANAGER: REPORTING_TREE
  // EMPLOYEE, STUDENT: OWN
  let defaultScope = 'OWN';
  if (['SUPER_ADMIN', 'ADMIN', 'CMD', 'HR', 'FINANCE'].includes(user.role)) {
    defaultScope = 'ALL';
  } else if (user.role === 'MANAGER') {
    defaultScope = 'REPORTING_TREE';
  }

  const effectiveScope = {
    scopeType: user.dataScope?.scopeType || defaultScope,
    allowedDepartmentIds: user.dataScope?.allowedDepartmentIds || [],
    allowedTeamIds: user.dataScope?.allowedTeamIds || [],
    allowedUserIds: user.dataScope?.allowedUserIds || [],
    isCustom: !!user.dataScope,
  };

  return {
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      status: user.status,
      employeeId: user.employeeId,
      department: user.department,
      designation: user.designation,
      manager: user.manager,
      accessProfileId: user.accessProfileId,
      accessProfile: user.accessProfile
        ? {
            id: user.accessProfile.id,
            name: user.accessProfile.name,
            role: user.accessProfile.role,
            description: user.accessProfile.description,
          }
        : null,
    },
    effectivePermissions,
    dataScope: effectiveScope,
    summary: {
      totalPermissions: PERMISSIONS_CATALOG.length,
      totalAllowed,
      totalOverrides,
      hasAccessProfile: !!user.accessProfile,
      profileName: user.accessProfile?.name || 'Role Defaults',
    },
  };
}

/**
 * 5. Check whether a user is authorized for a permission key and data context.
 *
 * @param {string} tenantId
 * @param {string} userId
 * @param {string} permissionKey
 * @param {object} context - { targetUserId, targetDepartment, targetTeamId }
 */
export async function checkUserPermission(tenantId, userId, permissionKey, context = {}) {
  if (!tenantId || !userId || !permissionKey) {
    return { allowed: false, reason: 'Missing authorization parameters' };
  }

  const user = await prisma.tenantUser.findFirst({
    where: { id: userId, tenantId, isDeleted: false },
    select: { id: true, role: true, status: true, department: true },
  });

  if (!user) {
    return { allowed: false, reason: 'User not found or deleted' };
  }

  if (user.status !== 'ACTIVE' && user.status !== 'INVITED') {
    return { allowed: false, reason: `Account status is ${user.status}` };
  }

  const { targetUserId, targetDepartment } = context;

  // Validate strict tenant boundary on target employee (prevent IDOR / cross-tenant leakage)
  let targetUserRecord = null;
  if (targetUserId) {
    targetUserRecord = await prisma.tenantUser.findFirst({
      where: { id: targetUserId, isDeleted: false },
      select: { id: true, tenantId: true, department: true, managerId: true },
    });
    if (!targetUserRecord || targetUserRecord.tenantId !== tenantId) {
      return {
        allowed: false,
        reason: 'Target employee not found or belongs to a different organization (Cross-tenant boundary restriction)',
      };
    }
  }

  // Super admins have full organization-wide bypass strictly within their own tenant
  if (user.role === 'SUPER_ADMIN') {
    return { allowed: true, reason: 'Super Admin bypass' };
  }

  const { effectivePermissions, dataScope } = await getEffectiveUserPermissions(tenantId, userId);
  const perm = effectivePermissions[permissionKey];

  if (!perm || !perm.allowed) {
    return {
      allowed: false,
      reason: `User is not granted permission: ${permissionKey}`,
      permission: perm,
    };
  }

  // If no data target in context, permission check succeeds
  if (!targetUserId && !targetDepartment) {
    return { allowed: true };
  }

  // Check Data-Level Access Scope
  const { scopeType, allowedDepartmentIds, allowedUserIds } = dataScope;

  if (scopeType === 'ALL') {
    return { allowed: true };
  }

  if (targetUserId) {
    // If accessing self, always allowed under own records
    if (targetUserId === userId) {
      return { allowed: true };
    }

    if (scopeType === 'OWN') {
      return {
        allowed: false,
        reason: 'User data scope restricted to own records only',
      };
    }

    if (scopeType === 'DIRECT_REPORTS') {
      if (targetUserRecord?.managerId === userId) {
        return { allowed: true };
      }
      return {
        allowed: false,
        reason: 'Target employee is not a direct report',
      };
    }

    if (scopeType === 'REPORTING_TREE') {
      const downline = await getReportingDownlineUserIds(tenantId, userId);
      if (downline.includes(targetUserId)) {
        return { allowed: true };
      }
      return {
        allowed: false,
        reason: 'Target employee is outside user reporting tree downline',
      };
    }

    if (scopeType === 'DEPARTMENT') {
      const allowedDepts = new Set([
        user.department,
        ...(Array.isArray(allowedDepartmentIds) ? allowedDepartmentIds : []),
      ]);
      if (targetUserRecord?.department && allowedDepts.has(targetUserRecord.department)) {
        return { allowed: true };
      }
      return {
        allowed: false,
        reason: 'Target employee is outside authorized departments',
      };
    }

    if (scopeType === 'ASSIGNED') {
      const allowedUsers = new Set(Array.isArray(allowedUserIds) ? allowedUserIds : []);
      if (allowedUsers.has(targetUserId)) {
        return { allowed: true };
      }
      return {
        allowed: false,
        reason: 'Target employee is not in assigned employee list',
      };
    }
  }

  if (targetDepartment) {
    if (scopeType === 'DEPARTMENT') {
      const allowedDepts = new Set([
        user.department,
        ...(Array.isArray(allowedDepartmentIds) ? allowedDepartmentIds : []),
      ]);
      if (allowedDepts.has(targetDepartment)) {
        return { allowed: true };
      }
      return {
        allowed: false,
        reason: 'Target department is outside authorized departments',
      };
    }
  }

  return { allowed: true };
}

/**
 * 6. Set User Permissions, Access Profile, and Data Scope.
 * Validates role ceiling, delegation constraints, and logs audit trail.
 */
export async function setUserPermissions(tenantId, actor, targetUserId, payload) {
  const { profileId, overrides = {}, dataScope, reason = 'Administrative update', ipAddress } = payload;

  if (!tenantId || !actor || !targetUserId) {
    throw new Error('tenantId, actor, and targetUserId are required');
  }

  // 1. Fetch target user
  const targetUser = await prisma.tenantUser.findFirst({
    where: { id: targetUserId, tenantId, isDeleted: false },
    include: {
      accessProfile: true,
      userPermissions: true,
      dataScope: true,
    },
  });

  if (!targetUser) {
    throw new Error('Target user not found');
  }

  // 2. Fetch actor permissions & role
  const isSuperOrAdmin = ['SUPER_ADMIN', 'ADMIN'].includes(actor.role);
  if (!isSuperOrAdmin) {
    // Check delegation constraints:
    // Actor must be in upper reporting line of targetUser OR have user.permissions.manage
    const actorEffective = await getEffectiveUserPermissions(tenantId, actor.userId || actor.id);
    const canManageUsers = actorEffective.effectivePermissions['user.permissions.manage']?.allowed;

    if (!canManageUsers) {
      // Check if targetUser is in actor's reporting downline
      const downline = await getReportingDownlineUserIds(tenantId, actor.userId || actor.id);
      if (!downline.includes(targetUserId)) {
        throw new Error('Forbidden: You are not authorized to manage permissions for this employee');
      }
    }

    // Actor cannot grant any permission that actor does not possess
    for (const [permKey, accessType] of Object.entries(overrides)) {
      if (accessType === 'ALLOW') {
        const actorHasPerm = actorEffective.effectivePermissions[permKey]?.allowed;
        if (!actorHasPerm) {
          throw new Error(`Delegation Error: You cannot grant '${permKey}' because you do not hold this permission`);
        }
      }
    }
  }

  // 3. Role ceiling check on targetUser:
  // Target user CANNOT receive an ALLOW for a permission outside their role's ceiling
  const targetRoleConfig = ROLE_PERMISSION_CEILINGS[targetUser.role] || { ceiling: [] };
  const targetCeilingSet = new Set(targetRoleConfig.ceiling);

  for (const [permKey, accessType] of Object.entries(overrides)) {
    if (accessType === 'ALLOW' && !targetCeilingSet.has(permKey)) {
      throw new Error(`Role Ceiling Violation: Permission '${permKey}' exceeds role ceiling for role '${targetUser.role}'`);
    }
  }

  // 4. Validate profile role if profileId passed
  if (profileId) {
    const profile = await prisma.accessProfile.findFirst({
      where: { id: profileId, tenantId },
    });
    if (!profile) {
      throw new Error('Selected access profile does not exist');
    }
    if (profile.role !== targetUser.role && !isSuperOrAdmin) {
      throw new Error(`Access Profile '${profile.name}' is designed for role '${profile.role}', but user has role '${targetUser.role}'`);
    }
  }

  // 5. Compute audit changes
  const prevOverrides = {};
  for (const up of targetUser.userPermissions || []) {
    prevOverrides[up.permissionKey] = up.accessType;
  }
  const prevProfile = targetUser.accessProfile?.name || 'None';
  const prevScope = targetUser.dataScope?.scopeType || 'DEFAULT';

  // 6. Execute atomic update
  await prisma.$transaction(async (tx) => {
    // A. Update access profile linkage
    await tx.tenantUser.update({
      where: { id: targetUserId },
      data: {
        accessProfileId: profileId || null,
      },
    });

    // B. Delete existing user overrides
    await tx.userPermission.deleteMany({
      where: { tenantId, userId: targetUserId },
    });

    // C. Insert new user overrides
    const overrideEntries = Object.entries(overrides);
    for (const [permKey, accessType] of overrideEntries) {
      if (accessType === 'ALLOW' || accessType === 'DENY') {
        await tx.userPermission.create({
          data: {
            tenantId,
            userId: targetUserId,
            permissionKey: permKey,
            accessType,
            source: 'CUSTOM',
            assignedBy: actor.userId || actor.id,
            reason,
          },
        });
      }
    }

    // D. Update or create data scope
    if (dataScope && dataScope.scopeType) {
      await tx.userDataScope.upsert({
        where: { userId: targetUserId },
        create: {
          tenantId,
          userId: targetUserId,
          scopeType: dataScope.scopeType,
          allowedDepartmentIds: dataScope.allowedDepartmentIds || [],
          allowedTeamIds: dataScope.allowedTeamIds || [],
          allowedUserIds: dataScope.allowedUserIds || [],
        },
        update: {
          scopeType: dataScope.scopeType,
          allowedDepartmentIds: dataScope.allowedDepartmentIds || [],
          allowedTeamIds: dataScope.allowedTeamIds || [],
          allowedUserIds: dataScope.allowedUserIds || [],
        },
      });
    }

    // E. Create Audit Log Entry
    await tx.permissionAuditLog.create({
      data: {
        tenantId,
        actorId: actor.userId || actor.id,
        actorRole: actor.role || 'ADMIN',
        action: 'USER_PERMISSION_UPDATE',
        targetRole: targetUser.role,
        targetUserId,
        ipAddress: ipAddress || null,
        details: `Updated permissions for employee ${targetUser.name} (${targetUser.email}). Profile: ${profileId || 'None'}. Overrides: ${overrideEntries.length}. Scope: ${dataScope?.scopeType || prevScope}. Reason: ${reason}`,
        changes: {
          previous: {
            profile: prevProfile,
            overrides: prevOverrides,
            scope: prevScope,
          },
          updated: {
            profileId: profileId || null,
            overrides,
            scope: dataScope?.scopeType || prevScope,
            reason,
          },
        },
      },
    });
  });

  return getEffectiveUserPermissions(tenantId, targetUserId);
}

/**
 * 7. Reset User Permissions to Role Defaults.
 */
export async function resetUserPermissionsToDefaults(tenantId, actor, targetUserId, reason = 'Reset to role defaults', ipAddress) {
  if (!tenantId || !actor || !targetUserId) {
    throw new Error('tenantId, actor, and targetUserId are required');
  }

  const targetUser = await prisma.tenantUser.findFirst({
    where: { id: targetUserId, tenantId, isDeleted: false },
    include: { accessProfile: true, userPermissions: true },
  });

  if (!targetUser) {
    throw new Error('Target user not found');
  }

  await prisma.$transaction(async (tx) => {
    // Remove profile and overrides
    await tx.tenantUser.update({
      where: { id: targetUserId },
      data: { accessProfileId: null },
    });

    await tx.userPermission.deleteMany({
      where: { tenantId, userId: targetUserId },
    });

    await tx.userDataScope.deleteMany({
      where: { tenantId, userId: targetUserId },
    });

    await tx.permissionAuditLog.create({
      data: {
        tenantId,
        actorId: actor.userId || actor.id,
        actorRole: actor.role || 'ADMIN',
        action: 'RESET_DEFAULTS',
        targetRole: targetUser.role,
        targetUserId,
        ipAddress: ipAddress || null,
        details: `Reset user permissions to role defaults for ${targetUser.name} (${targetUser.email}).`,
        changes: {
          action: 'RESET_TO_ROLE_DEFAULTS',
          reason,
        },
      },
    });
  });

  return getEffectiveUserPermissions(tenantId, targetUserId);
}

/**
 * 8. List Access Profiles for Tenant.
 */
export async function listAccessProfiles(tenantId, role = null) {
  await ensureTenantDefaultProfiles(tenantId);

  const where = { tenantId };
  if (role) where.role = role;

  const profiles = await prisma.accessProfile.findMany({
    where,
    include: {
      accessProfilePermissions: true,
      _count: {
        select: { users: true },
      },
    },
    orderBy: { createdAt: 'asc' },
  });

  return profiles.map((p) => {
    const permMap = {};
    for (const app of p.accessProfilePermissions) {
      permMap[app.permissionKey] = app.accessType;
    }
    return {
      id: p.id,
      name: p.name,
      role: p.role,
      description: p.description,
      isDefault: p.isDefault,
      userCount: p._count.users,
      permissions: permMap,
      createdAt: p.createdAt,
      updatedAt: p.updatedAt,
    };
  });
}

/**
 * 9. Create or Update Access Profile.
 */
export async function createOrUpdateAccessProfile(tenantId, actor, payload) {
  const { profileId, name, role, description, permissions = {}, ipAddress } = payload;

  if (!name || !role) {
    throw new Error('Profile name and role are required');
  }

  // Validate permissions against role ceiling
  const roleConfig = ROLE_PERMISSION_CEILINGS[role] || { ceiling: [] };
  const ceilingSet = new Set(roleConfig.ceiling);

  for (const [permKey, accessType] of Object.entries(permissions)) {
    if (accessType === 'ALLOW' && !ceilingSet.has(permKey)) {
      throw new Error(`Profile permission '${permKey}' exceeds role ceiling for role '${role}'`);
    }
  }

  let profile;
  await prisma.$transaction(async (tx) => {
    if (profileId) {
      profile = await tx.accessProfile.update({
        where: { id: profileId },
        data: { name, description, updatedAt: new Date() },
      });
      await tx.accessProfilePermission.deleteMany({
        where: { profileId },
      });
    } else {
      profile = await tx.accessProfile.create({
        data: {
          tenantId,
          name,
          role,
          description,
        },
      });
    }

    // Insert permissions
    for (const [permKey, accessType] of Object.entries(permissions)) {
      if (accessType === 'ALLOW' || accessType === 'DENY') {
        await tx.accessProfilePermission.create({
          data: {
            profileId: profile.id,
            permissionKey: permKey,
            accessType,
          },
        });
      }
    }

    // Audit log
    await tx.permissionAuditLog.create({
      data: {
        tenantId,
        actorId: actor.userId || actor.id,
        actorRole: actor.role || 'ADMIN',
        action: profileId ? 'ACCESS_PROFILE_UPDATE' : 'ACCESS_PROFILE_CREATE',
        targetRole: role,
        ipAddress: ipAddress || null,
        details: `${profileId ? 'Updated' : 'Created'} access profile '${name}' for role ${role}`,
        changes: {
          profileId: profile.id,
          name,
          role,
          permissionsCount: Object.keys(permissions).length,
        },
      },
    });
  });

  return profile;
}

/**
 * 10. Delete Access Profile.
 */
export async function deleteAccessProfile(tenantId, actor, profileId, ipAddress) {
  const profile = await prisma.accessProfile.findFirst({
    where: { id: profileId, tenantId },
    include: { _count: { select: { users: true } } },
  });

  if (!profile) {
    throw new Error('Access profile not found');
  }

  if (profile._count.users > 0) {
    throw new Error(`Cannot delete profile '${profile.name}' because ${profile._count.users} user(s) are currently assigned to it`);
  }

  await prisma.$transaction(async (tx) => {
    await tx.accessProfilePermission.deleteMany({ where: { profileId } });
    await tx.accessProfile.delete({ where: { id: profileId } });

    await tx.permissionAuditLog.create({
      data: {
        tenantId,
        actorId: actor.userId || actor.id,
        actorRole: actor.role || 'ADMIN',
        action: 'ACCESS_PROFILE_DELETE',
        targetRole: profile.role,
        ipAddress: ipAddress || null,
        details: `Deleted access profile '${profile.name}' (${profile.role})`,
        changes: { profileId, name: profile.name, role: profile.role },
      },
    });
  });

  return { success: true, deletedId: profileId };
}

/**
 * 11. Searchable User List with Permissions & Access Control info.
 */
export async function getUsersForAccessControl(tenantId, options = {}) {
  const {
    search,
    department,
    role,
    managerId,
    profileId,
    status,
    page = 1,
    limit = 20,
  } = options;

  await ensureTenantDefaultProfiles(tenantId);

  const where = {
    tenantId,
    isDeleted: false,
  };

  if (search && search.trim()) {
    const q = search.trim();
    where.OR = [
      { name: { contains: q, mode: 'insensitive' } },
      { email: { contains: q, mode: 'insensitive' } },
      { employeeId: { contains: q, mode: 'insensitive' } },
    ];
  }

  if (department && department !== 'ALL') {
    where.department = department;
  }

  if (role && role !== 'ALL') {
    where.role = role;
  }

  if (managerId && managerId !== 'ALL') {
    where.managerId = managerId;
  }

  if (profileId) {
    if (profileId === 'NONE') {
      where.accessProfileId = null;
    } else if (profileId !== 'ALL') {
      where.accessProfileId = profileId;
    }
  }

  if (status && status !== 'ALL') {
    where.status = status;
  }

  const skip = (Math.max(1, parseInt(page, 10)) - 1) * parseInt(limit, 10);
  const take = parseInt(limit, 10);

  const [total, users] = await Promise.all([
    prisma.tenantUser.count({ where }),
    prisma.tenantUser.findMany({
      where,
      skip,
      take,
      include: {
        accessProfile: {
          select: { id: true, name: true, role: true },
        },
        manager: {
          select: { id: true, name: true, email: true, employeeId: true },
        },
        userPermissions: {
          select: { permissionKey: true, accessType: true },
        },
        dataScope: {
          select: { scopeType: true },
        },
      },
      orderBy: [{ role: 'asc' }, { name: 'asc' }],
    }),
  ]);

  const items = users.map((u) => {
    const roleConfig = ROLE_PERMISSION_CEILINGS[u.role] || { defaults: [] };
    const overridesCount = u.userPermissions.length;
    return {
      id: u.id,
      name: u.name,
      email: u.email,
      employeeId: u.employeeId || '—',
      department: u.department || 'General',
      designation: u.designation || '—',
      role: u.role,
      status: u.status,
      reportingManager: u.manager ? { id: u.manager.id, name: u.manager.name } : null,
      accessProfile: u.accessProfile ? { id: u.accessProfile.id, name: u.accessProfile.name } : null,
      overridesCount,
      dataScope: u.dataScope?.scopeType || (['SUPER_ADMIN', 'ADMIN', 'HR', 'FINANCE'].includes(u.role) ? 'ALL' : u.role === 'MANAGER' ? 'REPORTING_TREE' : 'OWN'),
    };
  });

  return {
    total,
    page: parseInt(page, 10),
    limit: parseInt(limit, 10),
    totalPages: Math.ceil(total / take) || 1,
    users: items,
  };
}

/**
 * 12. Get User Permission Audit History.
 */
export async function getUserPermissionAuditHistory(tenantId, { targetUserId, page = 1, limit = 20 } = {}) {
  const where = { tenantId };
  if (targetUserId) {
    where.targetUserId = targetUserId;
  }

  const skip = (Math.max(1, parseInt(page, 10)) - 1) * parseInt(limit, 10);
  const take = parseInt(limit, 10);

  const [total, logs] = await Promise.all([
    prisma.permissionAuditLog.count({ where }),
    prisma.permissionAuditLog.findMany({
      where,
      skip,
      take,
      include: {
        actor: {
          select: { id: true, name: true, email: true, role: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    }),
  ]);

  return {
    total,
    page: parseInt(page, 10),
    limit: parseInt(limit, 10),
    totalPages: Math.ceil(total / take) || 1,
    logs,
  };
}
