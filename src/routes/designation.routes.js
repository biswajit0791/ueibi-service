import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { requirePlatformOwner, requirePlatformMenu } from '../middleware/rbac.js';
import {
  listDesignationsPublic,
  listDesignationsAdmin,
  getDesignationAdmin,
  createDesignation,
  updateDesignation,
  updateDesignationStatus,
  deleteDesignation,
} from '../controllers/designation.controller.js';

const router = Router();

// ══════════════════════════════════════════════════════════════════
// PUBLIC APIS FOR REGISTRATION DROPDOWNS
// ══════════════════════════════════════════════════════════════════
router.get('/public/designations', listDesignationsPublic);
router.get('/registrations/designations', listDesignationsPublic);

// ══════════════════════════════════════════════════════════════════
// PLATFORM OWNER ADMIN APIS (/platform/designations)
// ══════════════════════════════════════════════════════════════════
router.get(
  '/platform/designations',
  requireAuth,
  requirePlatformMenu('designations'),
  listDesignationsAdmin
);
router.get(
  '/platform/designations/:id',
  requireAuth,
  requirePlatformMenu('designations'),
  getDesignationAdmin
);
router.post(
  '/platform/designations',
  requireAuth,
  requirePlatformOwner,
  createDesignation
);
router.put(
  '/platform/designations/:id',
  requireAuth,
  requirePlatformOwner,
  updateDesignation
);
router.patch(
  '/platform/designations/:id/status',
  requireAuth,
  requirePlatformOwner,
  updateDesignationStatus
);
router.delete(
  '/platform/designations/:id',
  requireAuth,
  requirePlatformOwner,
  deleteDesignation
);

// ══════════════════════════════════════════════════════════════════
// ALIAS FOR /platform-admin/designations
// ══════════════════════════════════════════════════════════════════
router.get(
  '/platform-admin/designations',
  requireAuth,
  requirePlatformOwner,
  listDesignationsAdmin
);
router.get(
  '/platform-admin/designations/:id',
  requireAuth,
  requirePlatformOwner,
  getDesignationAdmin
);
router.post(
  '/platform-admin/designations',
  requireAuth,
  requirePlatformOwner,
  createDesignation
);
router.put(
  '/platform-admin/designations/:id',
  requireAuth,
  requirePlatformOwner,
  updateDesignation
);
router.patch(
  '/platform-admin/designations/:id/status',
  requireAuth,
  requirePlatformOwner,
  updateDesignationStatus
);
router.delete(
  '/platform-admin/designations/:id',
  requireAuth,
  requirePlatformOwner,
  deleteDesignation
);

export default router;
