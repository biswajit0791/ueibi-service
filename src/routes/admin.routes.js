import { Router } from 'express';
import { login, verify, logout } from '../controllers/adminSession.controller.js';
import { list, create, get, update, remove } from '../controllers/coupon.controller.js';
import { requireAdminSession } from '../middleware/requireAdminSession.js';
import { adminLoginRateLimit } from '../middleware/rateLimit.js';

const router = Router();

router.post('/admin/session', adminLoginRateLimit, login);
router.get('/admin/session/verify', verify);
router.post('/admin/session/logout', logout);

router.get('/admin/coupons', requireAdminSession, list);
router.post('/admin/coupons', requireAdminSession, create);
router.get('/admin/coupons/:id', requireAdminSession, get);
router.patch('/admin/coupons/:id', requireAdminSession, update);
router.delete('/admin/coupons/:id', requireAdminSession, remove);

export default router;
