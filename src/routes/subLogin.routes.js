import { Router } from 'express';
import subLoginController from '../controllers/subLogin.controller.js';
import { requireAuth } from '../middleware/auth.js';
import { requireTenant } from '../middleware/tenantScope.js';
import { authorize } from '../middleware/rbac.js';

const router = Router();

// Sub-logins are ordinary TenantUsers holding REGISTRY_* capabilities. Managing
// them is gated to the roles that can already invite people; per-capability
// authority is enforced again in the service (HR may grant registry
// credentials, but not LEADERSHIP).
const MANAGE = authorize('SUPER_ADMIN', 'ADMIN', 'HR');

router.get('/sublogins/presets', requireAuth, requireTenant, MANAGE, (req, res) => subLoginController.listPresets(req, res));
router.get('/sublogins/audit', requireAuth, requireTenant, MANAGE, (req, res) => subLoginController.audit(req, res));

router.get('/sublogins', requireAuth, requireTenant, MANAGE, (req, res) => subLoginController.list(req, res));
router.post('/sublogins', requireAuth, requireTenant, MANAGE, (req, res) => subLoginController.invite(req, res));
router.patch('/sublogins/:id', requireAuth, requireTenant, MANAGE, (req, res) => subLoginController.update(req, res));
router.delete('/sublogins/:id', requireAuth, requireTenant, MANAGE, (req, res) => subLoginController.revoke(req, res));

export default router;
