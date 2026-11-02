import { Router } from 'express';
import { handleRazorpayWebhook } from '../controllers/webhook.controller.js';

const router = Router();

// Webhook listener for payment gateway callbacks
router.post('/webhooks/razorpay', handleRazorpayWebhook);

export default router;

