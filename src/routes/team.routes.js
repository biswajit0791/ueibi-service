import { Router } from 'express';
import multer from 'multer';
import {
  getTeamDirectory,
  getTeamMemberDetail,
  getTeamMemberProjects,
  createTrainingRecord,
  updateTrainingRecord,
  deleteTrainingRecord,
  uploadEntityAttachment,
  downloadEntityAttachment,
  createAchievement,
  createIncident,
  updateIncident,
} from '../controllers/team.controller.js';
import { requireAuth } from '../middleware/auth.js';
import { requireTenant } from '../middleware/tenantScope.js';

const router = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB — enforced again inside storageService.validateFile
});

router.get('/team/directory', requireAuth, requireTenant, getTeamDirectory);
router.get('/team/:employeeId/detail', requireAuth, requireTenant, getTeamMemberDetail);
router.get('/team/:employeeId/projects', requireAuth, requireTenant, getTeamMemberProjects);

// Training / Certifications
router.post('/team/:employeeId/training', requireAuth, requireTenant, createTrainingRecord);
router.patch('/team/:employeeId/training/:id', requireAuth, requireTenant, updateTrainingRecord);
router.delete('/team/:employeeId/training/:id', requireAuth, requireTenant, deleteTrainingRecord);

// Achievements & Incidents Journal
router.post('/team/:employeeId/achievements', requireAuth, requireTenant, createAchievement);
router.post('/team/:employeeId/incidents', requireAuth, requireTenant, createIncident);
router.patch('/team/:employeeId/incidents/:id', requireAuth, requireTenant, updateIncident);

// Attachments — shared by training/achievements/incidents (:entityKind is
// one of those three route-segment names, validated inside the controller).
router.post('/team/:entityKind/:id/attachment', requireAuth, requireTenant, upload.single('file'), uploadEntityAttachment);
router.get('/team/:entityKind/:id/attachment/:attachmentId', requireAuth, requireTenant, downloadEntityAttachment);

export default router;
