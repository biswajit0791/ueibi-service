import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { requirePlatformOwner } from '../middleware/rbac.js';
import {
  listOrganizationStructuresPublic,
  listOrganizationStructuresAdmin,
  getOrganizationStructureAdmin,
  createOrganizationStructure,
  updateOrganizationStructure,
  updateOrganizationStructureStatus,
  deleteOrganizationStructure,
} from '../controllers/organizationStructure.controller.js';

const router = Router();

// Public API for company registration
router.get('/public/organization-structures', listOrganizationStructuresPublic);

// Platform Owner Admin APIs (mounted on /platform-admin/organization-structures)
router.get(
  '/platform-admin/organization-structures',
  requireAuth,
  requirePlatformOwner,
  listOrganizationStructuresAdmin
);
router.get(
  '/platform-admin/organization-structures/:id',
  requireAuth,
  requirePlatformOwner,
  getOrganizationStructureAdmin
);
router.post(
  '/platform-admin/organization-structures',
  requireAuth,
  requirePlatformOwner,
  createOrganizationStructure
);
router.put(
  '/platform-admin/organization-structures/:id',
  requireAuth,
  requirePlatformOwner,
  updateOrganizationStructure
);
router.patch(
  '/platform-admin/organization-structures/:id/status',
  requireAuth,
  requirePlatformOwner,
  updateOrganizationStructureStatus
);
router.delete(
  '/platform-admin/organization-structures/:id',
  requireAuth,
  requirePlatformOwner,
  deleteOrganizationStructure
);

// Convenient alias for /platform/organization-structures
router.get(
  '/platform/organization-structures',
  requireAuth,
  requirePlatformOwner,
  listOrganizationStructuresAdmin
);
router.get(
  '/platform/organization-structures/:id',
  requireAuth,
  requirePlatformOwner,
  getOrganizationStructureAdmin
);
router.post(
  '/platform/organization-structures',
  requireAuth,
  requirePlatformOwner,
  createOrganizationStructure
);
router.put(
  '/platform/organization-structures/:id',
  requireAuth,
  requirePlatformOwner,
  updateOrganizationStructure
);
router.patch(
  '/platform/organization-structures/:id/status',
  requireAuth,
  requirePlatformOwner,
  updateOrganizationStructureStatus
);
router.delete(
  '/platform/organization-structures/:id',
  requireAuth,
  requirePlatformOwner,
  deleteOrganizationStructure
);

export default router;

