import { Router } from 'express';
import {
  getSettings,
  patchSettings,
  getTopLevelEmployees,
  getWatcherCandidates,
  uploadCompanyLogo,
  deleteCompanyLogo,
} from '../controllers/companySettings.controller.js';
import { requireAuth } from '../middleware/auth.js';
import { requireTenant } from '../middleware/tenantScope.js';
import { authorize } from '../middleware/rbac.js';
import { checkModuleVisibility } from '../middleware/moduleVisibility.js';
import { logoUploadMiddleware } from '../middleware/logoUpload.js';

const router = Router();

router.get('/company/settings', requireAuth, requireTenant, getSettings);
router.patch('/company/settings', requireAuth, requireTenant, authorize('HR', 'SUPER_ADMIN', 'CMD', 'ADMIN'), checkModuleVisibility('company_settings'), patchSettings);
router.post('/company/logo', requireAuth, requireTenant, authorize('HR', 'SUPER_ADMIN', 'CMD', 'ADMIN'), checkModuleVisibility('company_settings'), logoUploadMiddleware('logo'), uploadCompanyLogo);
router.delete('/company/logo', requireAuth, requireTenant, authorize('HR', 'SUPER_ADMIN', 'CMD', 'ADMIN'), checkModuleVisibility('company_settings'), deleteCompanyLogo);
router.get('/company/top-level-employees', requireAuth, requireTenant, getTopLevelEmployees);
router.get('/company/watcher-candidates', requireAuth, requireTenant, getWatcherCandidates);

export default router;
