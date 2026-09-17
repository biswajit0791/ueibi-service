import { Router } from 'express';
import cxoController from '../controllers/cxo.controller.js';
import { requireAuth } from '../middleware/auth.js';
import { requireTenant } from '../middleware/tenantScope.js';

const router = Router();

// Everything here is authenticated and tenant-scoped. Leadership access is
// checked per-operation in the service via hasCapability, not by role alone.
router.use('/cxo', requireAuth, requireTenant);

router.get('/cxo/leaders', (req, res) => cxoController.listLeaders(req, res));
router.get('/cxo/stats', (req, res) => cxoController.getStats(req, res));

router.get('/cxo/messages', (req, res) => cxoController.listMessages(req, res));
router.post('/cxo/messages', (req, res) => cxoController.createMessage(req, res));
router.get('/cxo/messages/:id', (req, res) => cxoController.getMessage(req, res));
router.patch('/cxo/messages/:id', (req, res) => cxoController.updateMessage(req, res));
router.post('/cxo/messages/:id/replies', (req, res) => cxoController.addReply(req, res));

// Capability administration
router.get('/cxo/capabilities', (req, res) => cxoController.listCapabilityHolders(req, res));
router.post('/cxo/capabilities/grant', (req, res) => cxoController.grant(req, res));
router.post('/cxo/capabilities/revoke', (req, res) => cxoController.revoke(req, res));

export default router;
