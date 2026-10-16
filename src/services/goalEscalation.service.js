/**
 * goalEscalation.service.js
 *
 * Full-stack notification & role hierarchy approval escalation service for Goals & Tasks.
 *
 * Capabilities:
 *  1. Immediate Email Notification on Task/Goal Submission to Reporting Manager.
 *  2. Immediate Email Notifications on Manager Approval, Rejection, and HR Sign-off.
 *  3. SLA Monitoring (48 Hours): If a manager delays/avoids approving, approval escalates
 *     up the role hierarchy (Reporting Manager -> Senior Manager / Dept Head -> HR).
 *  4. Both In-App Notification and Branded HTML Email dispatched to higher authority.
 */
import { prisma } from '../lib/prisma.js';
import { sendMail } from '../lib/mailer.js';
import { emitToUser } from '../lib/socket.js';
import { env } from '../config/env.js';
import { HR_ROLES } from '../lib/roles.js';

// SLA: 48 Hours threshold before manager approval is considered overdue & escalated
const SLA_HOURS = 48;
const SLA_MS = SLA_HOURS * 60 * 60 * 1000;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

function getGoalsDashboardUrl() {
  const origin = env.frontendOrigin || 'http://localhost:5173';
  return `${origin}/uer/goals`;
}

/**
 * Builds clean, responsive email HTML for Goal & Task workflow actions
 */
export function buildGoalWorkflowEmailHtml({
  title,
  badgeText,
  badgeBg = '#6366f1',
  headline,
  description,
  goalTitle,
  submitterName,
  reviewerName,
  comment,
  isEscalated = false,
  escalationNote,
}) {
  const dashboardUrl = getGoalsDashboardUrl();

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
</head>
<body style="margin: 0; padding: 0; background-color: #f1f5f9; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #1e293b;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background-color: #f1f5f9; padding: 32px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width: 580px; width: 100%;">
          
          <!-- Header Banner -->
          <tr>
            <td style="background: linear-gradient(135deg, #0f172a 0%, #1e293b 100%); padding: 28px 36px; border-top-left-radius: 16px; border-top-right-radius: 16px; text-align: center;">
              <div style="display: inline-block; background-color: rgba(99, 102, 241, 0.15); border: 1px solid rgba(99, 102, 241, 0.3); border-radius: 10px; padding: 8px 18px;">
                <span style="font-size: 22px; font-weight: 800; letter-spacing: 2px; color: #ffffff;">KARYAM</span>
                <span style="display: inline-block; width: 7px; height: 7px; background-color: #6366f1; border-radius: 50%; margin-left: 4px;"></span>
              </div>
            </td>
          </tr>

          <!-- Main Card -->
          <tr>
            <td style="background-color: #ffffff; padding: 36px 32px; border-bottom-left-radius: 16px; border-bottom-right-radius: 16px; box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.05); border: 1px solid #e2e8f0; border-top: none;">
              
              <!-- Badge -->
              <div style="display: inline-block; background-color: ${badgeBg}; color: #ffffff; font-size: 11px; font-weight: 800; padding: 4px 10px; border-radius: 20px; letter-spacing: 0.5px; margin-bottom: 16px;">
                ${badgeText}
              </div>

              <h2 style="margin: 0 0 12px 0; font-size: 20px; font-weight: 700; color: #0f172a;">
                ${headline}
              </h2>

              <p style="margin: 0 0 20px 0; font-size: 14.5px; line-height: 1.6; color: #475569;">
                ${description}
              </p>

              <!-- Goal Card Summary -->
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background: #f8fafc; border-radius: 10px; border: 1px solid #e2e8f0; margin-bottom: 24px; padding: 16px;">
                <tr>
                  <td>
                    <div style="font-size: 11px; font-weight: 700; color: #64748b; text-transform: uppercase; margin-bottom: 4px;">Goal / Objective</div>
                    <div style="font-size: 15px; font-weight: 700; color: #0f172a; margin-bottom: 12px;">"${goalTitle}"</div>
                    
                    ${submitterName ? `
                      <div style="font-size: 11px; font-weight: 700; color: #64748b; text-transform: uppercase; margin-bottom: 2px;">Submitted By</div>
                      <div style="font-size: 13.5px; font-weight: 600; color: #1e293b; margin-bottom: 10px;">${submitterName}</div>
                    ` : ''}

                    ${reviewerName ? `
                      <div style="font-size: 11px; font-weight: 700; color: #64748b; text-transform: uppercase; margin-bottom: 2px;">Reviewed By</div>
                      <div style="font-size: 13.5px; font-weight: 600; color: #1e293b; margin-bottom: 10px;">${reviewerName}</div>
                    ` : ''}

                    ${comment ? `
                      <div style="font-size: 11px; font-weight: 700; color: #64748b; text-transform: uppercase; margin-bottom: 2px;">Notes / Remarks</div>
                      <div style="font-size: 13.5px; font-weight: 500; color: #334155; background: #ffffff; padding: 8px 12px; border-radius: 6px; border-left: 3px solid #6366f1;">"${comment}"</div>
                    ` : ''}

                    ${isEscalated ? `
                      <div style="margin-top: 12px; padding: 10px 12px; background: rgba(239, 68, 68, 0.08); border-radius: 6px; border-left: 3px solid #ef4444;">
                        <div style="font-size: 12px; font-weight: 700; color: #b91c1c;">⚠️ Role Hierarchy Escalation</div>
                        <div style="font-size: 12px; color: #7f1d1d; margin-top: 2px;">${escalationNote}</div>
                      </div>
                    ` : ''}
                  </td>
                </tr>
              </table>

              <!-- Action Button -->
              <div style="text-align: center; margin: 28px 0 16px 0;">
                <a href="${dashboardUrl}" style="display: inline-block; background: linear-gradient(135deg, #6366f1 0%, #4f46e5 100%); color: #ffffff; font-size: 14px; font-weight: 700; text-decoration: none; padding: 12px 28px; border-radius: 8px; box-shadow: 0 4px 12px rgba(99, 102, 241, 0.35);">
                  Open Goal in Dashboard
                </a>
              </div>

            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding: 20px; text-align: center; font-size: 12px; color: #94a3b8;">
              <p style="margin: 0 0 4px 0;">Karyam Enterprise Goal & Performance Management</p>
              <p style="margin: 0;">Automated notification. Please do not reply directly to this email.</p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

/**
 * Sends an email notification to the reporting manager when an employee submits tasks for review.
 */
export async function sendGoalSubmissionEmail({
  tenantId,
  goal,
  submitterUser,
  managerUser,
}) {
  if (!managerUser?.email) return null;

  const subject = `[Action Required] Review Submission: "${goal.title}" by ${submitterUser.name}`;
  const html = buildGoalWorkflowEmailHtml({
    title: subject,
    badgeText: 'ACTION REQUIRED: MANAGER REVIEW',
    badgeBg: '#f59e0b',
    headline: 'Tasks Submitted for Manager Approval',
    description: `${submitterUser.name} has completed assigned tasks on "${goal.title}" and submitted them for your review and approval.`,
    goalTitle: goal.title,
    submitterName: submitterUser.name,
    comment: 'All required tasks have been marked completed. Please inspect and approve or request changes.',
  });
  const text = `Action Required: ${submitterUser.name} submitted tasks on "${goal.title}" for manager review.\n\nOpen dashboard: ${getGoalsDashboardUrl()}`;

  try {
    return await sendMail({
      to: managerUser.email.toLowerCase(),
      subject,
      text,
      html,
      event: 'GOAL_SUBMITTED_FOR_MANAGER_REVIEW',
    });
  } catch (err) {
    console.warn(`[goalEscalation] Failed to send submission email to manager ${managerUser.email}:`, err.message);
    return null;
  }
}

/**
 * Sends email notifications when a manager or HR acts on a goal (Approved or Revisions Requested).
 */
export async function sendGoalReviewResultEmail({
  tenantId,
  goal,
  reviewerUser,
  action, // 'APPROVE' | 'REJECT'
  comment,
  recipientUser,
  stage = 'manager', // 'manager' | 'hr'
}) {
  if (!recipientUser?.email) return null;

  const isApprove = action === 'APPROVE';
  const isManagerStage = stage === 'manager';

  let subject = '';
  let badgeText = '';
  let badgeBg = '';
  let headline = '';
  let description = '';

  if (isManagerStage) {
    if (isApprove) {
      subject = `[Update] Manager Approved: "${goal.title}"`;
      badgeText = 'MANAGER APPROVED';
      badgeBg = '#10b981';
      headline = 'Manager Approved Your Tasks';
      description = `Manager ${reviewerUser.name} has approved your submitted tasks on "${goal.title}". The goal has been forwarded for final HR sign-off.`;
    } else {
      subject = `[Action Required] Revisions Requested: "${goal.title}"`;
      badgeText = 'CHANGES REQUESTED';
      badgeBg = '#ef4444';
      headline = 'Revisions Requested by Manager';
      description = `Manager ${reviewerUser.name} requested changes on your submission for "${goal.title}". Please review the remarks below, update your tasks, and resubmit.`;
    }
  } else {
    // HR stage
    if (isApprove) {
      subject = `[Final Sign-off] Goal Completed: "${goal.title}"`;
      badgeText = 'GOAL COMPLETED';
      badgeBg = '#10b981';
      headline = 'Final HR Approval Granted';
      description = `HR has given final sign-off on "${goal.title}". Your goal and tasks are now officially completed!`;
    } else {
      subject = `[Action Required] HR Requested Revisions: "${goal.title}"`;
      badgeText = 'HR CHANGES REQUESTED';
      badgeBg = '#ef4444';
      headline = 'HR Requested Changes';
      description = `HR requested revisions on "${goal.title}". Reason: "${comment || 'Revisions required'}".`;
    }
  }

  const html = buildGoalWorkflowEmailHtml({
    title: subject,
    badgeText,
    badgeBg,
    headline,
    description,
    goalTitle: goal.title,
    reviewerName: reviewerUser.name,
    comment,
  });
  const text = `${headline}\n\nGoal: "${goal.title}"\nReviewer: ${reviewerUser.name}\n${comment ? `Remarks: "${comment}"\n` : ''}\nOpen dashboard: ${getGoalsDashboardUrl()}`;

  try {
    return await sendMail({
      to: recipientUser.email.toLowerCase(),
      subject,
      text,
      html,
      event: `GOAL_${stage.toUpperCase()}_${action}`,
    });
  } catch (err) {
    console.warn(`[goalEscalation] Failed to send review result email to ${recipientUser.email}:`, err.message);
    return null;
  }
}

/**
 * Checks all pending manager reviews across the system and escalates any that have
 * exceeded the SLA threshold (48 hours) up the role hierarchy.
 */
export async function checkOverdueGoalApprovalsAndEscalate() {
  const now = new Date();
  const cutoff = new Date(now.getTime() - SLA_MS);

  // Find assignments stuck in PENDING_MANAGER_REVIEW or SUBMITTED older than SLA
  const pendingAssignments = await prisma.goalAssignment.findMany({
    where: {
      status: { in: ['PENDING_MANAGER_REVIEW', 'SUBMITTED'] },
      updatedAt: { lte: cutoff },
    },
    include: {
      goal: {
        select: {
          id: true,
          title: true,
          tenantId: true,
          employeeId: true,
          createdById: true,
        },
      },
      employee: {
        select: {
          id: true,
          name: true,
          email: true,
          managerId: true,
          department: true,
          role: true,
        },
      },
    },
  });

  if (pendingAssignments.length === 0) {
    return { scanned: 0, escalated: 0 };
  }

  let escalatedCount = 0;

  for (const assignment of pendingAssignments) {
    const { goal, employee: targetUser, tenantId } = assignment;
    if (!goal || !targetUser) continue;

    const daysPending = Math.floor((now.getTime() - new Date(assignment.updatedAt).getTime()) / MS_PER_DAY);
    const hoursPending = Math.floor((now.getTime() - new Date(assignment.updatedAt).getTime()) / (60 * 60 * 1000));

    // Check if we already logged an escalation audit for this goal & employee today
    // to throttle escalation notifications to once per 24 hours.
    const oneDayAgo = new Date(now.getTime() - MS_PER_DAY);
    const recentAudit = await prisma.goalAuditLog.findFirst({
      where: {
        goalId: goal.id,
        action: 'APPROVAL_ESCALATED',
        createdAt: { gte: oneDayAgo },
        details: { contains: targetUser.id },
      },
    });

    if (recentAudit) {
      continue; // already escalated today
    }

    // Determine the reporting manager
    let directManager = null;
    if (targetUser.managerId) {
      directManager = await prisma.tenantUser.findUnique({
        where: { id: targetUser.managerId },
        select: { id: true, name: true, email: true, managerId: true, role: true },
      });
    }

    // Look up higher authority up the role hierarchy:
    // Direct Manager -> Direct Manager's reporting manager (Senior Manager / Dept Head / VP)
    let higherAuthority = null;
    if (directManager?.managerId) {
      higherAuthority = await prisma.tenantUser.findUnique({
        where: { id: directManager.managerId },
        select: { id: true, name: true, email: true, role: true },
      });
    }

    // Also fetch HR users for the tenant
    const hrUsers = await prisma.tenantUser.findMany({
      where: { tenantId, role: { in: HR_ROLES }, isDeleted: false },
      select: { id: true, name: true, email: true },
    });

    const managerName = directManager ? directManager.name : 'Unassigned Manager';
    const escalationTargetLabel = higherAuthority
      ? `Senior Manager ${higherAuthority.name}`
      : 'HR Department';

    const escalationNote = `This review has been awaiting approval from Manager ${managerName} for ${hoursPending} hours (>48h SLA). It has been automatically escalated to ${escalationTargetLabel} for intervention.`;

    // 1. Notify Higher Manager (if available) via Email and In-App
    if (higherAuthority?.email) {
      const subject = `⚠️ [ESCALATED APPROVAL] Overdue Review: "${goal.title}" (Assignee: ${targetUser.name})`;
      const html = buildGoalWorkflowEmailHtml({
        title: subject,
        badgeText: `⚠️ OVERDUE ESCALATION (${daysPending}d)`,
        badgeBg: '#ef4444',
        headline: `Overdue Approval Escalated from Manager ${managerName}`,
        description: `The task submission for ${targetUser.name} on "${goal.title}" has been pending approval for ${hoursPending} hours without action. As the higher reporting authority in the role hierarchy, this review has been escalated to you for approval.`,
        goalTitle: goal.title,
        submitterName: targetUser.name,
        reviewerName: `Assigned: ${managerName}`,
        isEscalated: true,
        escalationNote,
      });
      const text = `⚠️ Overdue Approval Escalation: "${goal.title}" for ${targetUser.name} has been pending with ${managerName} for ${hoursPending} hours.\n\nOpen dashboard: ${getGoalsDashboardUrl()}`;

      try {
        await sendMail({
          to: higherAuthority.email.toLowerCase(),
          subject,
          text,
          html,
          event: 'GOAL_APPROVAL_ESCALATED_TO_SENIOR_MANAGER',
        });
      } catch (err) {
        console.warn(`[goalEscalation] Failed to email higher authority ${higherAuthority.email}:`, err.message);
      }

      // In-app notification
      try {
        const notif = await prisma.notification.create({
          data: {
            tenantId,
            recipientId: higherAuthority.id,
            type: 'goal_update',
            title: `⚠️ Overdue Review Escalation (${hoursPending}h)`,
            body: `Approval for ${targetUser.name} on "${goal.title}" is pending with ${managerName} for >48h. Escalated to you.`,
            entityType: 'goal',
            entityId: goal.id,
          },
        });
        emitToUser(tenantId, higherAuthority.id, 'notification', notif);
      } catch (_) {}
    }

    // 2. Notify HR via In-App and Email
    for (const hr of hrUsers) {
      if (higherAuthority && hr.id === higherAuthority.id) continue;

      try {
        const notif = await prisma.notification.create({
          data: {
            tenantId,
            recipientId: hr.id,
            type: 'goal_update',
            title: `⚠️ SLA Escalation: "${goal.title}"`,
            body: `Approval for ${targetUser.name} has been pending with Manager ${managerName} for ${hoursPending}h.`,
            entityType: 'goal',
            entityId: goal.id,
          },
        });
        emitToUser(tenantId, hr.id, 'notification', notif);
      } catch (_) {}

      if (hr.email) {
        const hrSubject = `⚠️ [SLA Escalation] Overdue Manager Approval on "${goal.title}"`;
        const hrHtml = buildGoalWorkflowEmailHtml({
          title: hrSubject,
          badgeText: `⚠️ SLA BREACH (${hoursPending}H)`,
          badgeBg: '#ea580c',
          headline: `Approval SLA Breached by Manager ${managerName}`,
          description: `Goal "${goal.title}" submitted by ${targetUser.name} has been awaiting manager review for ${hoursPending} hours. HR intervention or direct sign-off is now available.`,
          goalTitle: goal.title,
          submitterName: targetUser.name,
          reviewerName: `Direct Manager: ${managerName}`,
          isEscalated: true,
          escalationNote,
        });

        try {
          await sendMail({
            to: hr.email.toLowerCase(),
            subject: hrSubject,
            text: `SLA Escalation: "${goal.title}" pending with ${managerName} for ${hoursPending}h.`,
            html: hrHtml,
            event: 'GOAL_APPROVAL_ESCALATED_TO_HR',
          });
        } catch (_) {}
      }
    }

    // 3. Log Audit Trail Entry for this escalation
    try {
      const performerId = directManager?.id || targetUser.id;
      await prisma.goalAuditLog.create({
        data: {
          goalId: goal.id,
          performedById: performerId,
          action: 'APPROVAL_ESCALATED',
          details: `Approval for employee [${targetUser.id}] ${targetUser.name} escalated to ${escalationTargetLabel} due to >48h manager review inactivity (${hoursPending}h elapsed).`,
        },
      });
    } catch (err) {
      console.warn('[goalEscalation] Notice creating escalation audit log:', err.message);
    }

    escalatedCount++;
  }

  return { scanned: pendingAssignments.length, escalated: escalatedCount };
}

let escalationIntervalHandle = null;

/**
 * Starts the periodic background escalation sweep.
 * Runs on boot, then periodically (default every 12 hours).
 */
export function startGoalEscalationSchedule(intervalMs = 12 * 60 * 60 * 1000) {
  if (escalationIntervalHandle) clearInterval(escalationIntervalHandle);

  const runSweep = (label) => {
    checkOverdueGoalApprovalsAndEscalate()
      .then(({ scanned, escalated }) => {
        if (escalated > 0) {
          console.log(`[goalEscalation] ${label}: ${escalated}/${scanned} overdue manager review(s) escalated up role hierarchy.`);
        }
      })
      .catch((err) => console.warn(`[goalEscalation] ${label} sweep failed:`, err.message));
  };

  runSweep('Boot sweep');
  escalationIntervalHandle = setInterval(() => runSweep('Periodic sweep'), intervalMs);
  escalationIntervalHandle.unref?.();

  return escalationIntervalHandle;
}
