import { Router } from 'express';
import {
  getFinanceSummary,
  pricingPreview,
  approve,
  confirmCheque,
  createOrder,
  verifyPayment,
} from '../controllers/finance.controller.js';

const router = Router();

router.get('/finance/registrations/:token', getFinanceSummary);
router.post('/finance/registrations/:token/pricing-preview', pricingPreview);
router.post('/finance/registrations/:token/approve', approve);
router.post('/finance/registrations/:token/confirm-cheque', confirmCheque);
router.post('/finance/registrations/:token/create-order', createOrder);
router.post('/finance/registrations/:token/verify-payment', verifyPayment);

export default router;
