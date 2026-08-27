import { Router } from 'express';
import { getHrSummary, activate } from '../controllers/hr.controller.js';

const router = Router();

router.get('/hr/registrations/:token', getHrSummary);
router.post('/hr/registrations/:token/activate', activate);

export default router;
