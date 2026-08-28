import { Router } from 'express';
import {
  inviteEmployee,
  onboardEmployee,
  listEmployees,
  listExEmployees,
  addExEmployee,
  bulkAddExEmployees,
  listNonJoiners,
  addNonJoiner,
  bulkAddNonJoiners,
  updateEmployee,
  updateExEmployee,
  updateNonJoiner,
  deleteEmployee,
  deleteExEmployee,
  deleteNonJoiner,
} from '../controllers/employee.controller.js';
import { requireAuth } from '../middleware/auth.js';
import { requireTenant } from '../middleware/tenantScope.js';
import { authorize } from '../middleware/rbac.js';

const router = Router();

router.post('/employees', requireAuth, requireTenant, authorize('SUPER_ADMIN', 'ADMIN', 'HR'), inviteEmployee);
router.patch('/employees/onboard', requireAuth, requireTenant, onboardEmployee);
router.get('/employees', requireAuth, requireTenant, listEmployees);
router.patch('/employees/:id', requireAuth, requireTenant, authorize('SUPER_ADMIN', 'ADMIN', 'HR'), updateEmployee);
router.delete('/employees/:id', requireAuth, requireTenant, authorize('SUPER_ADMIN', 'ADMIN', 'HR'), deleteEmployee);

router.get('/employees/ex', requireAuth, requireTenant, listExEmployees);
router.post('/employees/ex', requireAuth, requireTenant, authorize('SUPER_ADMIN', 'ADMIN', 'HR'), addExEmployee);
router.post('/employees/ex/bulk', requireAuth, requireTenant, authorize('SUPER_ADMIN', 'ADMIN', 'HR'), bulkAddExEmployees);
router.patch('/employees/ex/:id', requireAuth, requireTenant, authorize('SUPER_ADMIN', 'ADMIN', 'HR'), updateExEmployee);
router.delete('/employees/ex/:id', requireAuth, requireTenant, authorize('SUPER_ADMIN', 'ADMIN', 'HR'), deleteExEmployee);

router.get('/employees/offers', requireAuth, requireTenant, listNonJoiners);
router.post('/employees/offers', requireAuth, requireTenant, authorize('SUPER_ADMIN', 'ADMIN', 'HR'), addNonJoiner);
router.post('/employees/offers/bulk', requireAuth, requireTenant, authorize('SUPER_ADMIN', 'ADMIN', 'HR'), bulkAddNonJoiners);
router.patch('/employees/offers/:id', requireAuth, requireTenant, authorize('SUPER_ADMIN', 'ADMIN', 'HR'), updateNonJoiner);
router.delete('/employees/offers/:id', requireAuth, requireTenant, authorize('SUPER_ADMIN', 'ADMIN', 'HR'), deleteNonJoiner);

export default router;
