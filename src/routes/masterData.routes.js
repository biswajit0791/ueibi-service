import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { requirePlatformOwner, requirePlatformMenu } from '../middleware/rbac.js';
import {
  listCities,
  getCityById,
  createCity,
  updateCity,
  toggleCityStatus,
  deleteCity,
  listIndustries,
  getIndustryById,
  createIndustry,
  updateIndustry,
  toggleIndustryStatus,
  deleteIndustry,
  listSubscriptionDurations,
  getSubscriptionDurationById,
  createSubscriptionDuration,
  updateSubscriptionDuration,
  toggleSubscriptionDurationStatus,
  deleteSubscriptionDuration,
  getActiveMasterData,
} from '../controllers/masterData.controller.js';

const router = Router();

// Consumer endpoint: Active master data for BDM coupons and forms
router.get(
  '/active',
  requireAuth,
  getActiveMasterData
);

// ─── CITIES CRUD ──────────────────────────────────────────────
router.get(
  '/cities',
  requireAuth,
  requirePlatformMenu('master_data'),
  listCities
);
router.get(
  '/cities/:id',
  requireAuth,
  requirePlatformMenu('master_data'),
  getCityById
);
router.post(
  '/cities',
  requireAuth,
  requirePlatformOwner,
  createCity
);
router.put(
  '/cities/:id',
  requireAuth,
  requirePlatformOwner,
  updateCity
);
router.patch(
  '/cities/:id/status',
  requireAuth,
  requirePlatformOwner,
  toggleCityStatus
);
router.delete(
  '/cities/:id',
  requireAuth,
  requirePlatformOwner,
  deleteCity
);

// ─── INDUSTRIES CRUD ──────────────────────────────────────────
router.get(
  '/industries',
  requireAuth,
  requirePlatformMenu('master_data'),
  listIndustries
);
router.get(
  '/industries/:id',
  requireAuth,
  requirePlatformMenu('master_data'),
  getIndustryById
);
router.post(
  '/industries',
  requireAuth,
  requirePlatformOwner,
  createIndustry
);
router.put(
  '/industries/:id',
  requireAuth,
  requirePlatformOwner,
  updateIndustry
);
router.patch(
  '/industries/:id/status',
  requireAuth,
  requirePlatformOwner,
  toggleIndustryStatus
);
router.delete(
  '/industries/:id',
  requireAuth,
  requirePlatformOwner,
  deleteIndustry
);

// ─── SUBSCRIPTION DURATIONS CRUD ──────────────────────────────
router.get(
  '/subscription-durations',
  requireAuth,
  requirePlatformMenu('master_data'),
  listSubscriptionDurations
);
router.get(
  '/subscription-durations/:id',
  requireAuth,
  requirePlatformMenu('master_data'),
  getSubscriptionDurationById
);
router.post(
  '/subscription-durations',
  requireAuth,
  requirePlatformOwner,
  createSubscriptionDuration
);
router.put(
  '/subscription-durations/:id',
  requireAuth,
  requirePlatformOwner,
  updateSubscriptionDuration
);
router.patch(
  '/subscription-durations/:id/status',
  requireAuth,
  requirePlatformOwner,
  toggleSubscriptionDurationStatus
);
router.delete(
  '/subscription-durations/:id',
  requireAuth,
  requirePlatformOwner,
  deleteSubscriptionDuration
);

export default router;
