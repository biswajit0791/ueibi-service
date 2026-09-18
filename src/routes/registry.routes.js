import { Router } from 'express';
import { searchRegistry } from '../controllers/registry.controller.js';
import { requireAuth } from '../middleware/auth.js';
import { requireTenant } from '../middleware/tenantScope.js';
import { canSearchRegistry } from '../lib/capabilities.js';

const router = Router();

// Tenant-scoped registry search — restricted to the roles the sidebar already
// only shows this link to (previously any authenticated role could hit this
// by direct URL; the route had no authorize() gate at all).
// Access is now role OR capability. Every role that could reach this before
// still can — REGISTRY_SEARCH only ADDS access, so a recruiter sub-login can
// search without being made an admin.
function allowRegistrySearch(req, res, next) {
  if (canSearchRegistry(req.user)) return next();
  return res.status(403).json({ error: 'Access forbidden: registry search requires the Registry Search credential' });
}

router.get('/registry/search', requireAuth, requireTenant, allowRegistrySearch, searchRegistry);

export default router;
