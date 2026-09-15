import { Router } from 'express';
import healthController from '../controllers/health.controller.js';

const router = Router();

router.get('/health', (req, res) => healthController.getHealth(req, res));
router.get('/health/db', (req, res) => healthController.getDbHealth(req, res));

export default router;
