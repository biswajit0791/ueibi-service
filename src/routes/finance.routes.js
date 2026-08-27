import { Router } from 'express';
import {
  getFinanceSummary,
  pricingPreview,
  approve,
  confirmCheque,
} from '../controllers/finance.controller.js';

const router = Router();

router.get('/finance/registrations/:token', getFinanceSummary);
router.post('/finance/registrations/:token/pricing-preview', pricingPreview);
router.post('/finance/registrations/:token/approve', approve);
router.post('/finance/registrations/:token/confirm-cheque', confirmCheque);

export default router;
