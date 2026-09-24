import { Router } from 'express';
import {
  listPublicLegalDocuments,
  getPublicLegalDocument,
  listLegalDocuments,
  getLegalDocument,
  createLegalDocument,
  updateLegalDocument,
  deleteLegalDocument,
  createLegalVersion,
  updateLegalVersion,
  publishLegalVersion,
  deleteLegalVersion,
  listLegalAcceptances,
} from '../controllers/legal.controller.js';
import { requireAuth } from '../middleware/auth.js';
import { requirePlatformOwner } from '../middleware/rbac.js';

const router = Router();

// ── Public ──────────────────────────────────────────────────────────────────
// Deliberately unauthenticated. Somebody deciding whether to sign up has no
// account yet, and terms they cannot read before agreeing are not terms.
// Only PUBLISHED versions are ever served here; a draft is never reachable.
router.get('/legal', listPublicLegalDocuments);
router.get('/legal/:slug', getPublicLegalDocument);

// ── Platform owner ──────────────────────────────────────────────────────────
// Authoring. A published version is immutable: amending terms creates a new
// version, which is what preserves the record of what each customer agreed to.
router.get('/platform/legal', requireAuth, requirePlatformOwner, listLegalDocuments);
router.post('/platform/legal', requireAuth, requirePlatformOwner, createLegalDocument);
router.get('/platform/legal/:slug', requireAuth, requirePlatformOwner, getLegalDocument);
router.patch('/platform/legal/:slug', requireAuth, requirePlatformOwner, updateLegalDocument);
// Refused once any version has been accepted — that acceptance is the evidence
// of what a company agreed to.
router.delete('/platform/legal/:slug', requireAuth, requirePlatformOwner, deleteLegalDocument);
router.get('/platform/legal/:slug/acceptances', requireAuth, requirePlatformOwner, listLegalAcceptances);
router.post('/platform/legal/:slug/versions', requireAuth, requirePlatformOwner, createLegalVersion);
router.patch('/platform/legal/:slug/versions/:versionId', requireAuth, requirePlatformOwner, updateLegalVersion);
router.delete('/platform/legal/:slug/versions/:versionId', requireAuth, requirePlatformOwner, deleteLegalVersion);
router.post('/platform/legal/:slug/versions/:versionId/publish', requireAuth, requirePlatformOwner, publishLegalVersion);

export default router;
