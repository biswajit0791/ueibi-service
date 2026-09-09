import { Router } from 'express';
import {
  createCycle,
  listCycles,
  getActiveCycle,
  updateCycle,
  updateParameter,
  createParameter,
  deleteParameter,
  listParameters,
  getMyReview,
  updateSelfAssessment,
  getMyGoals,
  getDirectReports,
  getEmployeeReviewForManager,
  updateManagerReview,
  createPeerNomination,
  getPendingNominationsForMe,
  submitPeerFeedback,
  getReceivedPeerFeedback,
  getCmdPeerFeedbackForEmployee,
  getMyNominatedPeers,
  deletePeerNomination,
  getHrAuditReview,
  updateHrAuditReview,
  getMyAllReviews,
  submitSelfRating,
  submitManagerRating,
  listAppraisals,
  getReviewById,
  deleteReview,
  updateReview,
  syncGoalsToAppraisal,
} from '../controllers/appraisal.controller.js';
import { requireAuth } from '../middleware/auth.js';
import { requireTenant } from '../middleware/tenantScope.js';
import { authorize } from '../middleware/rbac.js';

const router = Router();

// ── Appraisal Submissions & Reviews ──────────────────────────────────────────
router.post('/appraisals/submit', requireAuth, requireTenant, submitSelfRating);
router.patch('/appraisals/:id/manager-review', requireAuth, requireTenant, submitManagerRating);
router.get('/appraisals', requireAuth, requireTenant, listAppraisals);
router.get('/appraisals/:id', requireAuth, requireTenant, getReviewById);
router.delete('/appraisals/:id', requireAuth, requireTenant, deleteReview);
router.patch('/appraisals/:id', requireAuth, requireTenant, updateReview);
router.delete('/performance-reviews/:id', requireAuth, requireTenant, deleteReview);
router.patch('/performance-reviews/:id', requireAuth, requireTenant, updateReview);

// ── Phase 2: Cycle Settings (HR, Super Admin, CMD, Admin) ─────────────────────
router.post('/appraisal-cycles', requireAuth, requireTenant, authorize('HR', 'SUPER_ADMIN', 'CMD', 'ADMIN'), createCycle);
router.get('/appraisal-cycles', requireAuth, requireTenant, listCycles);
router.get('/appraisal-cycles/active', requireAuth, requireTenant, getActiveCycle);
router.patch('/appraisal-cycles/:id', requireAuth, requireTenant, authorize('HR', 'SUPER_ADMIN', 'CMD', 'ADMIN'), updateCycle);
router.get('/appraisal-parameters', requireAuth, requireTenant, listParameters);
router.post('/appraisal-parameters', requireAuth, requireTenant, authorize('HR', 'SUPER_ADMIN', 'CMD', 'ADMIN'), createParameter);
router.patch('/appraisal-parameters/:id', requireAuth, requireTenant, authorize('HR', 'SUPER_ADMIN', 'CMD', 'ADMIN'), updateParameter);
router.delete('/appraisal-parameters/:id', requireAuth, requireTenant, authorize('HR', 'SUPER_ADMIN', 'CMD', 'ADMIN'), deleteParameter);

// ── Phase 3: Self Assessment (Employee & above) ──────────────────────────────
router.get('/performance-reviews/mine', requireAuth, requireTenant, getMyReview);
router.get('/performance-reviews/:id', requireAuth, requireTenant, getReviewById);
router.patch('/performance-reviews/:id/self', requireAuth, requireTenant, updateSelfAssessment);

// ── Phase 4: Goals Alignment ─────────────────────────────────────────────────
router.get('/goals/mine', requireAuth, requireTenant, getMyGoals);
router.post('/goals/sync-to-appraisal', requireAuth, requireTenant, syncGoalsToAppraisal);

// ── Phase 5: Manager Evaluation & Subordinates ───────────────────────────────
router.get('/team/direct-reports', requireAuth, requireTenant, getDirectReports);
router.get('/performance-reviews/employee/:employeeId', requireAuth, requireTenant, getEmployeeReviewForManager);
router.patch('/performance-reviews/:id/manager', requireAuth, requireTenant, updateManagerReview);

// ── Phase 6: 360° Peer Feedback ──────────────────────────────────────────────
router.post('/peer-nominations', requireAuth, requireTenant, createPeerNomination);
router.get('/peer-nominations/mine', requireAuth, requireTenant, getMyNominatedPeers);
router.delete('/peer-nominations/:id', requireAuth, requireTenant, deletePeerNomination);
router.get('/peer-nominations/pending-for-me', requireAuth, requireTenant, getPendingNominationsForMe);
router.post('/peer-nominations/:id/feedback', requireAuth, requireTenant, submitPeerFeedback);
router.get('/peer-feedback/received-by-me', requireAuth, requireTenant, getReceivedPeerFeedback);
router.get('/cmd/peer-feedback/:employeeId', requireAuth, requireTenant, authorize('CMD', 'SUPER_ADMIN'), getCmdPeerFeedbackForEmployee);

// ── Phase 7: HR Audit & Hike ─────────────────────────────────────────────────
router.get('/performance-reviews/:employeeId/hr-audit', requireAuth, requireTenant, authorize('HR', 'SUPER_ADMIN', 'CMD'), getHrAuditReview);
router.patch('/performance-reviews/:id/hr-audit', requireAuth, requireTenant, authorize('HR', 'SUPER_ADMIN'), updateHrAuditReview);

// ── Phase 9: Reviews Dashboard (/uer/reviews) ────────────────────────────────
router.get('/performance-reviews/mine/all', requireAuth, requireTenant, getMyAllReviews);

export default router;
