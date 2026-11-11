import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { requirePlatformOwner } from '../middleware/rbac.js';
import {
  listConfigurations,
  getConfigurationByKey,
  updateConfiguration,
  bulkUpdateConfigurations,
  restoreDefaults,
  getConfigurationHistory,
} from '../controllers/registrationConfig.controller.js';

const router = Router();

// Routes mounted on /platform-admin/registration-configurations
router.get(
  '/platform-admin/registration-configurations',
  requireAuth,
  requirePlatformOwner,
  listConfigurations,
);
router.get(
  '/platform-admin/registration-configurations/history',
  requireAuth,
  requirePlatformOwner,
  getConfigurationHistory,
);
router.post(
  '/platform-admin/registration-configurations/restore-defaults',
  requireAuth,
  requirePlatformOwner,
  restoreDefaults,
);
router.put(
  '/platform-admin/registration-configurations/bulk',
  requireAuth,
  requirePlatformOwner,
  bulkUpdateConfigurations,
);
router.get(
  '/platform-admin/registration-configurations/:key',
  requireAuth,
  requirePlatformOwner,
  getConfigurationByKey,
);
router.put(
  '/platform-admin/registration-configurations/:key',
  requireAuth,
  requirePlatformOwner,
  updateConfiguration,
);

// Convenient alias mounted on /platform/registration-configurations
router.get(
  '/platform/registration-configurations',
  requireAuth,
  requirePlatformOwner,
  listConfigurations,
);
router.get(
  '/platform/registration-configurations/history',
  requireAuth,
  requirePlatformOwner,
  getConfigurationHistory,
);
router.post(
  '/platform/registration-configurations/restore-defaults',
  requireAuth,
  requirePlatformOwner,
  restoreDefaults,
);
router.put(
  '/platform/registration-configurations/bulk',
  requireAuth,
  requirePlatformOwner,
  bulkUpdateConfigurations,
);
router.get(
  '/platform/registration-configurations/:key',
  requireAuth,
  requirePlatformOwner,
  getConfigurationByKey,
);
router.put(
  '/platform/registration-configurations/:key',
  requireAuth,
  requirePlatformOwner,
  updateConfiguration,
);

export default router;

