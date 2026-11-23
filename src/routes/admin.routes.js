import { Router } from 'express';
import { list, create, get, update, remove, removePermanently, markUsed, getPricingSettings } from '../controllers/coupon.controller.js';
import { listRegistrations, getRegistration } from '../controllers/adminRegistrations.controller.js';
import { requireAuth } from '../middleware/auth.js';
import { requirePlatformOwner, requirePlatformStaff, requirePlatformMenu } from '../middleware/rbac.js';

/**
 * Platform-operator routes for company registrations and discount coupons.
 *
 * These used to sit behind requireAdminSession — a single shared APP_PASSWORD
 * HMAC cookie that predated the PLATFORM_OWNER role. It carried no identity, so
 * nothing could be attributed or revoked per person, and it locked the platform
 * owner out of their own console.
 *
 * They now use the same gate as every other platform route. requireTenant is
 * deliberately absent: these read across tenants by design, and the coupon and
 * registration tables are not tenant-scoped at all.
 */
const router = Router();

// Company registrations — the onboarding queue.
router.get('/admin/registrations', requireAuth, requirePlatformMenu('onboarding'), listRegistrations);
router.get('/admin/registrations/:id', requireAuth, requirePlatformMenu('onboarding'), getRegistration);

// Discount coupons & company offers. Every mutation writes a PlatformAuditLog row.
// Sales/BD can view and create company-based offers; owner retains full management.
router.get('/admin/coupons/pricing-settings', requireAuth, requirePlatformMenu('bdm_coupons'), getPricingSettings);
router.get('/admin/coupons', requireAuth, requirePlatformMenu('bdm_coupons'), list);
router.post('/admin/coupons', requireAuth, requirePlatformMenu('bdm_coupons'), create);
router.get('/admin/coupons/:id', requireAuth, requirePlatformMenu('bdm_coupons'), get);
router.patch('/admin/coupons/:id', requireAuth, requirePlatformMenu('bdm_coupons'), update);
router.post('/admin/coupons/:id/mark-used', requireAuth, requirePlatformMenu('bdm_coupons'), markUsed);
// DELETE deactivates (the row must survive so past redemptions still resolve).
// /permanent removes it outright, and refuses once a coupon has been used.
router.delete('/admin/coupons/:id', requireAuth, requirePlatformOwner, remove);
router.delete('/admin/coupons/:id/permanent', requireAuth, requirePlatformOwner, removePermanently);

export default router;
