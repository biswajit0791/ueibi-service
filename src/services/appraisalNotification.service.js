import { prisma } from '../lib/prisma.js';
import { emitToUser } from '../lib/socket.js';

/**
 * Create a notification row AND push it over Socket.IO, so appraisal
 * notifications reach the client the same way task/goal notifications do.
 */
async function createAndPush(data) {
  const notif = await prisma.notification.create({ data });
  try {
    emitToUser(data.tenantId, data.recipientId, 'notification', notif);
  } catch (_) { /* socket layer is best-effort */ }
  return notif;
}

export class AppraisalNotificationService {
  /**
   * Notify employee when manager submits review
   */
  static async notifyManagerReviewSubmitted({ tenantId, employeeId, reviewId }) {
    try {
      if (!tenantId || !employeeId) return;
      await createAndPush({
          tenantId,
          recipientId: employeeId,
          type: 'appraisal',
          title: 'Manager Review Completed',
          body: 'Your manager has completed their evaluation for your performance review.',
          entityType: 'appraisal',
          entityId: reviewId,
      });
    } catch (err) {
      console.error('Failed to create manager review notification:', err);
    }
  }

  /**
   * Notify employee and manager when HR releases salary hike sign-off
   */
  static async notifyHrHikeReleased({ tenantId, employeeId, managerId, hikePercentage, reviewId }) {
    try {
      if (!tenantId || !employeeId) return;

      const hikeText = hikePercentage !== undefined && hikePercentage !== null ? `with a ${hikePercentage}% recommended hike` : '';

      // Employee notification
      await createAndPush({
          tenantId,
          recipientId: employeeId,
          type: 'appraisal',
          title: 'Appraisal Audit Released',
          body: `HR has finalized and released your appraisal audit sign-off ${hikeText}.`.trim(),
          entityType: 'appraisal',
          entityId: reviewId,
      });

      // Manager notification (if manager exists)
      if (managerId && managerId !== employeeId) {
        await createAndPush({
            tenantId,
            recipientId: managerId,
            type: 'appraisal',
            title: 'Subordinate Appraisal Sign-Off Released',
            body: `HR has completed the audit sign-off for your direct report's appraisal.`,
            entityType: 'appraisal',
            entityId: reviewId,
        });
      }
    } catch (err) {
      console.error('Failed to create HR hike release notification:', err);
    }
  }

  /**
   * Notify nominated peer reviewer
   */
  static async notifyPeerNominated({ tenantId, reviewerId, revieweeName, nominationId }) {
    try {
      if (!tenantId || !reviewerId) return;
      await createAndPush({
          tenantId,
          recipientId: reviewerId,
          type: 'appraisal',
          title: '360° Peer Feedback Requested',
          body: `${revieweeName || 'A colleague'} has nominated you to provide 360° peer feedback.`,
          entityType: 'peer_feedback',
          entityId: nominationId,
      });
    } catch (err) {
      console.error('Failed to create peer nomination notification:', err);
    }
  }

  /**
   * Notify reviewee when peer submits feedback (ANONYMOUS - never reveal reviewer name)
   */
  static async notifyPeerFeedbackReceived({ tenantId, revieweeId }) {
    try {
      if (!tenantId || !revieweeId) return;
      await createAndPush({
          tenantId,
          recipientId: revieweeId,
          type: 'appraisal',
          title: 'New 360° Feedback Received',
          body: 'You received new 360 peer feedback. Review the details in your dashboard.',
          entityType: 'peer_feedback',
      });
    } catch (err) {
      console.error('Failed to create peer feedback notification:', err);
    }
  }

  /**
   * Notify employee and HR when ex-employer verification completes
   */
  static async notifyExEmployerVerificationCompleted({ tenantId, employeeId, exCompany, reviewId }) {
    try {
      if (!tenantId || !employeeId) return;

      // Employee notification
      await createAndPush({
          tenantId,
          recipientId: employeeId,
          type: 'appraisal',
          title: 'Ex-Employer Verification Completed',
          body: `Verification from your previous employer (${exCompany}) has been successfully submitted.`,
          entityType: 'ex_review',
          entityId: reviewId,
      });

      // Find HR users to notify
      const hrUsers = await prisma.tenantUser.findMany({
        where: {
          tenantId,
          role: { in: ['HR', 'SUPER_ADMIN', 'CMD'] },
          status: 'ACTIVE',
        },
        select: { id: true },
      });

      for (const hr of hrUsers) {
        await createAndPush({
            tenantId,
            recipientId: hr.id,
            type: 'appraisal',
            title: 'Ex-Employer Verification Completed',
            body: `Conduct verification completed for an employee from ${exCompany}.`,
            entityType: 'ex_review',
            entityId: reviewId,
        });
      }
    } catch (err) {
      console.error('Failed to create ex-employer verification notification:', err);
    }
  }
}
