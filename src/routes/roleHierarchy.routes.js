import { Router } from 'express';
import {
  getSystemRoles,
  getOrgTree,
  getHierarchyChain,
  updateManagerAssignment,
  getPermissionMatrix,
} from '../controllers/roleHierarchy.controller.js';
import { requireAuth } from '../middleware/auth.js';
import { requireTenant } from '../middleware/tenantScope.js';
import { authorize } from '../middleware/rbac.js';

const router = Router();

// Read system role definitions and tier ladder (open to all authenticated company members)
router.get(
  '/hierarchy/system',
  requireAuth,
  requireTenant,
  getSystemRoles
);

// Read live organizational reporting tree
router.get(
  '/hierarchy/tree',
  requireAuth,
  requireTenant,
  getOrgTree
);

// Read chain of command for an employee
router.get(
  '/hierarchy/chain/:employeeId',
  requireAuth,
  requireTenant,
  getHierarchyChain
);

// Feature permission matrix
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

export default router;
