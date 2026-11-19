import { Router } from 'express';
import {
  getSystemRoles,
  getOrgTree,
  getHierarchyChain,
  updateManagerAssignment,
  getPermissionMatrix,
  updatePermissions,
  resetPermissions,
  getVisibility,
  updateVisibility,
  resetVisibility,
  getDashboardConfig,
  updateDashboardConfig,
  resetDashboardConfig,
  getAuditLogs,
} from '../controllers/roleHierarchy.controller.js';
import {
  getPermissionsCatalog,
  listUsersForAccessControl,
  getUserAccessDetails,
  updateUserAccess,
  resetUserAccess,
  listProfiles,
  saveProfile,
  removeProfile,
  getUserAudit,
} from '../controllers/userPermission.controller.js';
import { requireAuth } from '../middleware/auth.js';
import { requireTenant } from '../middleware/tenantScope.js';
import { authorize } from '../middleware/rbac.js';

const router = Router();

// Read system role definitions and tier ladder (open to all authenticated company members, filtered by visibility)
router.get(
  '/hierarchy/system',
  requireAuth,
  requireTenant,
  getSystemRoles
);

// Read live organizational reporting tree (filtered by visibility)
router.get(
  '/hierarchy/tree',
  requireAuth,
  requireTenant,
  getOrgTree
);

// Read chain of command for an employee (scoped to reporting lines)
router.get(
  '/hierarchy/chain/:employeeId',
  requireAuth,
  requireTenant,
  getHierarchyChain
);

router.get(
  '/role-hierarchy/employee/:employeeId/chain',
  requireAuth,
  requireTenant,
  getHierarchyChain
);

// Feature permission matrix (filtered by visibility)
router.get(
  '/hierarchy/matrix',
  requireAuth,
  requireTenant,
  getPermissionMatrix
);

// Update/assign reporting manager (SUPER_ADMIN, ADMIN, HR only)
router.patch(
  '/hierarchy/assign-manager',
  requireAuth,
  requireTenant,
  authorize('SUPER_ADMIN', 'ADMIN', 'HR'),
  updateManagerAssignment
);

// Update role-wise permissions in the matrix (SUPER_ADMIN, ADMIN only)
router.patch(
  '/hierarchy/permissions',
  requireAuth,
  requireTenant,
  authorize('SUPER_ADMIN', 'ADMIN'),
  updatePermissions
);

// Reset role-wise permissions to enterprise defaults (SUPER_ADMIN, ADMIN only)
router.post(
  '/hierarchy/permissions/reset',
  requireAuth,
  requireTenant,
  authorize('SUPER_ADMIN', 'ADMIN'),
  resetPermissions
);

// Read role hierarchy visibility configuration
router.get(
  '/hierarchy/visibility',
  requireAuth,
  requireTenant,
  getVisibility
);

// Update role hierarchy visibility configuration (SUPER_ADMIN, ADMIN, CMD)
router.patch(
  '/hierarchy/visibility',
  requireAuth,
  requireTenant,
  authorize('SUPER_ADMIN', 'ADMIN', 'CMD'),
  updateVisibility
);

// Reset role hierarchy & sidebar visibility configuration (SUPER_ADMIN, ADMIN, CMD)
router.post(
  '/hierarchy/visibility/reset',
  requireAuth,
  requireTenant,
  authorize('SUPER_ADMIN', 'ADMIN', 'CMD'),
  resetVisibility
);

// Read role dashboard widget configuration
router.get(
  '/hierarchy/dashboard-config',
  requireAuth,
  requireTenant,
  getDashboardConfig
);

// Update role dashboard widget configuration (SUPER_ADMIN, ADMIN only)
router.patch(
  '/hierarchy/dashboard-config',
  requireAuth,
  requireTenant,
  authorize('SUPER_ADMIN', 'ADMIN'),
  updateDashboardConfig
);

// Reset role dashboard widget configuration to defaults (SUPER_ADMIN, ADMIN only)
router.post(
  '/hierarchy/dashboard-config/reset',
  requireAuth,
  requireTenant,
  authorize('SUPER_ADMIN', 'ADMIN'),
  resetDashboardConfig
);

// Read audit trail logs for role permissions & visibility changes (SUPER_ADMIN, ADMIN, HR)
router.get(
  '/hierarchy/audit-logs',
  requireAuth,
  requireTenant,
  authorize('SUPER_ADMIN', 'ADMIN', 'HR'),
  getAuditLogs
);

// ============================================================================
// ENTERPRISE USER-LEVEL PERMISSION & ACCESS CONTROL ROUTES
// ============================================================================

// Read catalog of permissions across all 8 modules and role ceiling definitions
router.get(
  '/hierarchy/permissions-catalog',
  requireAuth,
  requireTenant,
  getPermissionsCatalog
);

// Search and filter users for the User-Level Access Control table
router.get(
  '/hierarchy/user-permissions',
  requireAuth,
  requireTenant,
  authorize('SUPER_ADMIN', 'ADMIN', 'CMD', 'HR', 'MANAGER'),
  listUsersForAccessControl
);

// Read detailed access configuration and effective permissions for a user
router.get(
  '/hierarchy/user-permissions/:userId',
  requireAuth,
  requireTenant,
  authorize('SUPER_ADMIN', 'ADMIN', 'CMD', 'HR', 'MANAGER'),
  getUserAccessDetails
);

// Update user permission overrides, access profile, and data scope
router.post(
  '/hierarchy/user-permissions/:userId',
  requireAuth,
  requireTenant,
  authorize('SUPER_ADMIN', 'ADMIN', 'HR', 'MANAGER'),
  updateUserAccess
);

// Reset user permissions to role defaults
router.post(
  '/hierarchy/user-permissions/:userId/reset',
  requireAuth,
  requireTenant,
  authorize('SUPER_ADMIN', 'ADMIN', 'HR'),
  resetUserAccess
);

// List access profile templates
router.get(
  '/hierarchy/access-profiles',
  requireAuth,
  requireTenant,
  authorize('SUPER_ADMIN', 'ADMIN', 'CMD', 'HR', 'MANAGER'),
  listProfiles
);

// Create or update an access profile template
router.post(
  '/hierarchy/access-profiles',
  requireAuth,
  requireTenant,
  authorize('SUPER_ADMIN', 'ADMIN', 'HR'),
  saveProfile
);

// Delete an access profile template
router.delete(
  '/hierarchy/access-profiles/:profileId',
  requireAuth,
  requireTenant,
  authorize('SUPER_ADMIN', 'ADMIN', 'HR'),
  removeProfile
);

// Read permission audit history
router.get(
  '/hierarchy/user-permissions/:userId/audit',
  requireAuth,
  requireTenant,
  authorize('SUPER_ADMIN', 'ADMIN', 'HR'),
  getUserAudit
);

export default router;
