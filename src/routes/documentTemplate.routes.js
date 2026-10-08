/**
 * @file documentTemplate.routes.js
 * @description Express routes for Document Template Engine.
 */

import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { requireTenant } from '../middleware/tenantScope.js';
import { authorize } from '../middleware/rbac.js';
import {
  listTemplates,
  getTemplate,
  createTemplate,
  updateTemplate,
  publishTemplate,
  cloneTemplate,
  deleteTemplate,
  setDefaultTemplate,
  listVersions,
  rollbackVersion,
  listTokens,
  createCustomToken,
  resolveTokens,
  previewDocument,
  generateDocument,
  listGeneratedDocuments,
} from '../controllers/documentTemplate.controller.js';

const router = Router();

const hrAndAdmin = ['SUPER_ADMIN', 'ADMIN', 'HR'];
const adminOnly = ['SUPER_ADMIN', 'ADMIN'];

// ── Templates CRUD ──
router.get('/doc-templates', requireAuth, requireTenant, authorize(...hrAndAdmin), listTemplates);
router.post('/doc-templates', requireAuth, requireTenant, authorize(...adminOnly), createTemplate);
router.get('/doc-templates/:id', requireAuth, requireTenant, authorize(...hrAndAdmin), getTemplate);
router.put('/doc-templates/:id', requireAuth, requireTenant, authorize(...adminOnly), updateTemplate);
router.delete('/doc-templates/:id', requireAuth, requireTenant, authorize('SUPER_ADMIN'), deleteTemplate);

// ── Publishing & Actions ──
router.post('/doc-templates/:id/publish', requireAuth, requireTenant, authorize(...adminOnly), publishTemplate);
router.post('/doc-templates/:id/clone', requireAuth, requireTenant, authorize(...adminOnly), cloneTemplate);
router.patch('/doc-templates/:id/set-default', requireAuth, requireTenant, authorize(...adminOnly), setDefaultTemplate);

// ── Versions ──
router.get('/doc-templates/:id/versions', requireAuth, requireTenant, authorize(...hrAndAdmin), listVersions);
router.post('/doc-templates/:id/rollback/:version', requireAuth, requireTenant, authorize(...adminOnly), rollbackVersion);

// ── Tokens ──
router.get('/doc-templates/tokens/list', requireAuth, requireTenant, authorize(...hrAndAdmin), listTokens);
router.post('/doc-templates/tokens/custom', requireAuth, requireTenant, authorize(...adminOnly), createCustomToken);
router.post('/doc-templates/resolve-tokens', requireAuth, requireTenant, authorize(...hrAndAdmin), resolveTokens);

// ── Preview & Generation ──
router.post('/doc-templates/preview', requireAuth, requireTenant, authorize(...hrAndAdmin), previewDocument);
router.post('/doc-templates/generate', requireAuth, requireTenant, authorize(...hrAndAdmin), generateDocument);
router.get('/doc-templates/history/generated', requireAuth, requireTenant, authorize(...hrAndAdmin), listGeneratedDocuments);

export default router;
