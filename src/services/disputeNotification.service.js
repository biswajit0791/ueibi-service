import { prisma } from '../lib/prisma.js';
import { emitToUser } from '../lib/socket.js';
import { HR_ROLES } from '../lib/roles.js';

/** Mirrors appraisalNotification.service.js's createAndPush — create a
 * Notification row and push it over Socket.IO, best-effort. */
async function createAndPush(data) {
  const notif = await prisma.notification.create({ data });
  try {
    emitToUser(data.tenantId, data.recipientId, 'notification', notif);
  } catch (_) { /* socket layer is best-effort */ }
  return notif;
}

export class DisputeNotificationService {
  /** Notify all HR/Admin users in the tenant when a new ticket is raised. */
  static async notifyHrNewDispute({ tenantId, disputeId, ticketNumber, subject, raisedByName }) {
    try {
      if (!tenantId) return;
      const hrUsers = await prisma.tenantUser.findMany({
        where: { tenantId, role: { in: HR_ROLES }, status: 'ACTIVE' },
        select: { id: true },
      });
      for (const hr of hrUsers) {
        await createAndPush({
          tenantId,
          recipientId: hr.id,
          type: 'dispute',
          title: `New Dispute Ticket: ${ticketNumber}`,
          body: `${raisedByName || 'An employee'} raised a new dispute: "${subject}".`,
          entityType: 'dispute',
          entityId: disputeId,
        });
      }
    } catch (err) {
      console.error('Failed to create dispute-raised notification:', err);
    }
  }

  /** Notify the raiser and/or subject employee of a new reply from HR/Admin. */
  static async notifyDisputeReply({ tenantId, disputeId, ticketNumber, recipientIds, senderName }) {
    try {
      if (!tenantId || !recipientIds?.length) return;
      for (const recipientId of recipientIds) {
        await createAndPush({
          tenantId,
          recipientId,
          type: 'dispute',
          title: `New Reply on ${ticketNumber}`,
          body: `${senderName || 'Someone'} replied to your dispute ticket.`,
          entityType: 'dispute',
          entityId: disputeId,
        });
      }
    } catch (err) {
      console.error('Failed to create dispute-reply notification:', err);
    }
  }

  /** Notify the raiser/subject employee when HR changes ticket status. */
  static async notifyDisputeStatusChanged({ tenantId, disputeId, ticketNumber, recipientIds, status }) {
    try {
      if (!tenantId || !recipientIds?.length) return;
      for (const recipientId of recipientIds) {
        await createAndPush({
          tenantId,
          recipientId,
          type: 'dispute',
          title: `Dispute ${ticketNumber} Updated`,
          body: `Your dispute ticket status changed to ${status}.`,
          entityType: 'dispute',
          entityId: disputeId,
        });
      }
    } catch (err) {
      console.error('Failed to create dispute-status notification:', err);
    }
  }
}
