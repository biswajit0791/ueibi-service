import {
  getUsersForAccessControl,
  getEffectiveUserPermissions,
  setUserPermissions,
  resetUserPermissionsToDefaults,
  listAccessProfiles,
  createOrUpdateAccessProfile,
  deleteAccessProfile,
  getUserPermissionAuditHistory,
  ensurePermissionsCatalogSeeded,
} from '../services/permission.service.js';
import {
  PERMISSIONS_CATALOG,
  ROLE_PERMISSION_CEILINGS,
  PERMISSION_MODULES,
  DEFAULT_ACCESS_PROFILES,
} from '../lib/permissionsCatalog.js';

/**
 * 1. GET /api/hierarchy/permissions-catalog
 * Returns the entire permissions catalog and role ceiling definitions.
 */
export async function getPermissionsCatalog(req, res) {
  try {
    await ensurePermissionsCatalogSeeded();
    res.json({
      catalog: PERMISSIONS_CATALOG,
      modules: PERMISSION_MODULES,
      roleCeilings: ROLE_PERMISSION_CEILINGS,
    });
  } catch (err) {
    console.error('[getPermissionsCatalog] Error:', err);
    res.status(500).json({ error: 'Failed to retrieve permissions catalog' });
  }
}

/**
 * 2. GET /api/hierarchy/user-permissions
 * Searchable, filterable list of tenant users for User-Level Access Control tab.
 */
export async function listUsersForAccessControl(req, res) {
  try {
    const tenantId = req.user.tenantId;
    const {
      search,
      department,
      role,
      managerId,
      profileId,
      status,
      page = 1,
      limit = 20,
    } = req.query;

    const result = await getUsersForAccessControl(tenantId, {
      search,
      department,
      role,
      managerId,
      profileId,
      status,
      page,
      limit,
    });

    res.json(result);
  } catch (err) {
    console.error('[listUsersForAccessControl] Error:', err);
    res.status(500).json({ error: err.message || 'Failed to list users' });
  }
}

/**
 * 3. GET /api/hierarchy/user-permissions/:userId
 * Detailed access configuration & effective permissions for a single user.
 */
export async function getUserAccessDetails(req, res) {
  try {
    const tenantId = req.user.tenantId;
    const { userId } = req.params;

    const data = await getEffectiveUserPermissions(tenantId, userId);
    res.json(data);
  } catch (err) {
    console.error('[getUserAccessDetails] Error:', err);
    res.status(err.message === 'User not found or deleted' ? 404 : 500).json({
      error: err.message || 'Failed to fetch user access details',
    });
  }
}

/**
 * 4. POST /api/hierarchy/user-permissions/:userId
 * Assign individual permission overrides, access profile, and data scope.
 */
export async function updateUserAccess(req, res) {
  try {
    const tenantId = req.user.tenantId;
    const { userId } = req.params;
    const actor = req.user;
    const ipAddress = req.ip || req.headers['x-forwarded-for'];

    const { profileId, overrides, dataScope, reason } = req.body;

    const updated = await setUserPermissions(tenantId, actor, userId, {
      profileId,
      overrides,
      dataScope,
      reason,
      ipAddress,
    });

    res.json({
      message: 'User permissions and access configuration updated successfully',
      data: updated,
    });
  } catch (err) {
    console.error('[updateUserAccess] Error:', err);
    const status = err.message.includes('Ceiling Violation') || err.message.includes('Delegation Error') ? 400 : err.message.includes('Forbidden') ? 403 : 500;
    res.status(status).json({ error: err.message || 'Failed to update user access' });
  }
}

/**
 * 5. POST /api/hierarchy/user-permissions/:userId/reset
 * Reset user permissions to role defaults (removes profile & custom overrides).
 */
export async function resetUserAccess(req, res) {
  try {
    const tenantId = req.user.tenantId;
    const { userId } = req.params;
    const actor = req.user;
    const { reason = 'Reset to role defaults' } = req.body;
    const ipAddress = req.ip || req.headers['x-forwarded-for'];

    const reset = await resetUserPermissionsToDefaults(tenantId, actor, userId, reason, ipAddress);

    res.json({
      message: 'User permissions successfully reset to role defaults',
      data: reset,
    });
  } catch (err) {
    console.error('[resetUserAccess] Error:', err);
    res.status(500).json({ error: err.message || 'Failed to reset user access' });
  }
}

/**
 * 6. GET /api/hierarchy/access-profiles
 * List all access profiles for the tenant.
 */
export async function listProfiles(req, res) {
  try {
    const tenantId = req.user.tenantId;
    const { role } = req.query;

    const profiles = await listAccessProfiles(tenantId, role);
    res.json({ profiles });
  } catch (err) {
    console.error('[listProfiles] Error:', err);
    res.status(500).json({ error: 'Failed to fetch access profiles' });
  }
}

/**
 * 7. POST /api/hierarchy/access-profiles
 * Create or update an access profile template.
 */
export async function saveProfile(req, res) {
  try {
    const tenantId = req.user.tenantId;
    const actor = req.user;
    const ipAddress = req.ip || req.headers['x-forwarded-for'];
    const { profileId, name, role, description, permissions } = req.body;

    const saved = await createOrUpdateAccessProfile(tenantId, actor, {
      profileId,
      name,
      role,
      description,
      permissions,
      ipAddress,
    });

    res.json({
      message: `Access profile '${saved.name}' saved successfully`,
      profile: saved,
    });
  } catch (err) {
    console.error('[saveProfile] Error:', err);
    res.status(400).json({ error: err.message || 'Failed to save access profile' });
  }
}

/**
 * 8. DELETE /api/hierarchy/access-profiles/:profileId
 * Delete an access profile.
 */
export async function removeProfile(req, res) {
  try {
    const tenantId = req.user.tenantId;
    const actor = req.user;
    const { profileId } = req.params;
    const ipAddress = req.ip || req.headers['x-forwarded-for'];

    const result = await deleteAccessProfile(tenantId, actor, profileId, ipAddress);
    res.json(result);
  } catch (err) {
    console.error('[removeProfile] Error:', err);
    res.status(400).json({ error: err.message || 'Failed to delete access profile' });
  }
}

/**
 * 9. GET /api/hierarchy/user-permissions/:userId/audit
 * Get permission audit history for a specific user (or tenant wide).
 */
export async function getUserAudit(req, res) {
  try {
    const tenantId = req.user.tenantId;
    const { userId } = req.params;
    const { page = 1, limit = 20 } = req.query;

    const result = await getUserPermissionAuditHistory(tenantId, {
      targetUserId: userId !== 'all' ? userId : null,
      page,
      limit,
    });

    res.json(result);
  } catch (err) {
    console.error('[getUserAudit] Error:', err);
    res.status(500).json({ error: 'Failed to retrieve permission audit logs' });
  }
}
