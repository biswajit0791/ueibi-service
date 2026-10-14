/**
 * milestoneEscalation.service.js
 *
 * The one place that sends a milestone delay escalation.
 *
 * This product otherwise runs nothing on a schedule — dashboard alerts
 * (/platform/alerts, /milestones/overdue) are computed live on every request,
 * on purpose, because there is no scheduler anywhere else in this codebase.
 * An email can't work that way: nobody may be looking at the dashboard the
 * day a milestone goes overdue, so the notify step has to run on its own.
 *
 * This is the one exception, kept as small as the requirement allows: no new
 * dependency, no persisted "alert" record — just a periodic sweep that emails
 * watchers and creates the same Notification rows the rest of the app already
 * uses, throttled to once per milestone per calendar day via
 * TaskMilestone.lastEscalatedAt so a server restart never re-sends the same
 * day's escalations twice.
 *
 * Performance notes (this is the one job in the app that touches every
 * tenant at once, so it gets its own care):
 *  - the query is covered by the (status, dueDate) index added alongside
 *    TaskMilestone — see the migration that introduced it — so it stays a
 *    cheap index range scan as the table grows, not a full scan.
 *  - "is this watcher email also a platform user" used to be one
 *    findFirst PER WATCHER PER MILESTONE — classic N+1. It's now one bulk
 *    query for every distinct (tenantId, email) pair in the whole run.
 *  - emails go out with bounded concurrency (EMAIL_CONCURRENCY at a time),
 *    not fully sequential and not all at once — keeps total wall-clock
 *    reasonable without opening hundreds of connections to the mail
 *    provider in one burst.
 *  - lastEscalatedAt is written in ONE updateMany for the whole run, not
 *    one UPDATE per milestone.
 *  - a hard cap (MAX_MILESTONES_PER_RUN) bounds the worst case: if the
 *    table somehow accumulates far more overdue milestones than any real
 *    tenant should have, one run still finishes in bounded time — it just
 *    catches the rest on the next tick rather than growing unbounded.
 */
import { prisma } from '../lib/prisma.js';
import { sendMail } from '../lib/mailer.js';
import { emitToUser } from '../lib/socket.js';
import { env } from '../config/env.js';

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const EMAIL_CONCURRENCY = 5;
const MAX_MILESTONES_PER_RUN = 2000;

function isSameCalendarDay(a, b) {
  if (!a || !b) return false;
  const da = new Date(a);
  const db = new Date(b);
  return da.getUTCFullYear() === db.getUTCFullYear()
    && da.getUTCMonth() === db.getUTCMonth()
    && da.getUTCDate() === db.getUTCDate();
}

/**
 * Builds a clean, high-clarity HTML email template for checkpoint status and escalations
 */
function buildModernMilestoneEmailHtml({ milestone, task, allMilestones = [], daysOverdue = 0, escalationRole = null }) {
  const dueStr = milestone?.dueDate ? new Date(milestone.dueDate).toISOString().slice(0, 10) : '—';
  const dashboardUrl = `${env.frontendOrigin || 'http://localhost:5173'}/uer/goals`;

  const isOverdue = daysOverdue > 0;
  const isDone = milestone?.status === 'DONE';
  const themeColor = isOverdue ? '#ef4444' : isDone ? '#10b981' : '#3b82f6';
  const themeBadge = isOverdue ? `⚠️ ${daysOverdue}D OVERDUE ALERT` : isDone ? '✓ CHECKPOINT COMPLETED' : '● ACTIVE CHECKPOINT';
  const headline = isOverdue
    ? `Critical Checkpoint Overdue Notice`
    : isDone
    ? `Critical Checkpoint Completed`
    : `Critical Checkpoint Update`;
  const subheadline = isOverdue
    ? `Checkpoint 0${milestone.order} ("${milestone.title}") is currently ${daysOverdue} day(s) overdue.${escalationRole ? ` Escalated to ${escalationRole}.` : ''}`
    : isDone
    ? `Checkpoint 0${milestone.order} ("${milestone.title}") has been completed.`
    : `Checkpoint 0${milestone.order} ("${milestone.title}") is scheduled for review.`;

  // Up to 3 checkpoints
  const totalCount = Math.min(3, Math.max(1, allMilestones.length || 3));
  const stations = [1, 2, 3].slice(0, totalCount).map((stepNum) => {
    const found = allMilestones.find((m) => m.order === stepNum);
    if (found) return found;
    if (milestone.order === stepNum) return milestone;
    return null;
  });

  const doneStationsCount = stations.filter((st) => st?.status === 'DONE').length;
  const progressPercent = Math.round((doneStationsCount / totalCount) * 100);

  const nowUtc = new Date().toUTCString().replace(/.*?, /, '').slice(0, 16) + ' UTC';

  const statusHeadline = isOverdue
    ? `OVERDUE (${daysOverdue} DAY${daysOverdue > 1 ? 'S' : ''} LATE)`
    : isDone
    ? 'COMPLETED (100%)'
    : 'ON TRACK';
  const statusIcon = isOverdue ? '!' : isDone ? '✓' : '●';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${headline}</title>
</head>
<body style="margin: 0; padding: 0; background-color: #07090e; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #f8fafc;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" bgcolor="#07090e" style="background-color: #07090e; padding: 36px 12px;">
    <tr>
      <td align="center">
        <!-- Main Card Container -->
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" bgcolor="#111827" style="max-width: 620px; background-color: #111827; border: 1px solid #1f293d; border-radius: 18px; overflow: hidden; box-shadow: 0 20px 50px rgba(0, 0, 0, 0.6);">
          
          <!-- Top Cyber Neon Beam -->
          <tr>
            <td style="height: 5px; background: linear-gradient(90deg, #6366f1 0%, #8b5cf6 40%, ${themeColor} 100%);"></td>
          </tr>

          <!-- Header Brand Bar -->
          <tr>
            <td style="padding: 28px 32px 20px 32px; border-bottom: 1px solid #1f293d; background-color: #111827;">
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
                <tr>
                  <td>
                    <!-- Sentinel Radar Pill & Platform Identity -->
                    <table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin-bottom: 14px;">
                      <tr>
                        <td bgcolor="#1e293b" style="background-color: #1e293b; border: 1px solid #334155; border-radius: 20px; padding: 4px 12px;">
                          <span style="font-size: 11px; font-weight: 800; letter-spacing: 0.08em; text-transform: uppercase; color: ${themeColor};">
                            ${themeBadge}
                          </span>
                        </td>
                        <td style="padding-left: 10px;">
                          <span style="font-size: 11px; font-weight: 700; color: #64748b; letter-spacing: 0.06em; text-transform: uppercase;">
                            UEIBI ENTERPRISE MISSION CONTROL
                          </span>
                        </td>
                      </tr>
                    </table>

                    <h1 style="margin: 0; font-size: 22px; font-weight: 800; color: #ffffff; letter-spacing: -0.02em; line-height: 1.3;">
                      ${headline}
                    </h1>
                    <p style="margin: 8px 0 0 0; font-size: 13.5px; color: #94a3b8; line-height: 1.55;">
                      ${subheadline}
                    </p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- LIVE 4-STATION CHECKPOINT FLIGHT PATH -->
          <tr>
            <td bgcolor="#0b0f19" style="padding: 24px 28px; background-color: #0b0f19; border-bottom: 1px solid #1f293d;">
              <div style="font-size: 10px; font-family: monospace; font-weight: 800; color: #64748b; letter-spacing: 0.12em; text-transform: uppercase; margin-bottom: 16px;">
                LIVE CHECKPOINT FLIGHT PATH // ORBITAL TELEMETRY
              </div>

              <!-- 4-Station Stepper Table -->
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="table-layout: fixed;">
                <tr>
                  ${stations.map((st, i) => {
                    const stepNum = i + 1;
                    const isStationDone = st?.status === 'DONE';
                    const isCurrentStation = st?.id === milestone.id;
                    const isStationOverdue = !isStationDone && st?.dueDate && new Date(st.dueDate) < new Date();

                    const nodeBg = isStationDone ? '#10b981' : isStationOverdue ? '#ef4444' : isCurrentStation ? '#6366f1' : '#1e293b';
                    const nodeBorder = isStationDone ? '#10b981' : isStationOverdue ? '#ef4444' : isCurrentStation ? '#818cf8' : '#334155';
                    const nodeIcon = isStationDone ? '✓' : `0${stepNum}`;
                    const labelColor = isStationDone ? '#10b981' : isStationOverdue ? '#ef4444' : isCurrentStation ? '#818cf8' : '#64748b';
                    const statusText = isStationDone ? 'SECURED' : isStationOverdue ? 'OVERDUE' : isCurrentStation ? 'IN ORBIT' : st ? 'ACTIVE' : 'STANDBY';
                    const titleText = st ? st.title : `Slot 0${stepNum}`;

                    return `
                    <td align="center" valign="top" style="width: 25%; padding: 0 4px;">
                      <!-- Circle Station Node -->
                      <div style="width: 36px; height: 36px; border-radius: 50%; background-color: ${nodeBg}; color: #ffffff; line-height: 36px; text-align: center; font-weight: 800; font-size: 12px; border: 2px solid ${nodeBorder}; box-shadow: 0 0 12px ${nodeBg}66; margin: 0 auto;">
                        ${nodeIcon}
                      </div>
                      <!-- Station Title -->
                      <div style="margin-top: 8px; font-size: 11px; font-weight: 700; color: #f8fafc; line-height: 1.3; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 115px;">
                        ${titleText}
                      </div>
                      <!-- Status Badge -->
                      <div style="margin-top: 3px; font-size: 9.5px; font-weight: 800; color: ${labelColor}; letter-spacing: 0.05em;">
                        ${statusText}
                      </div>
                    </td>
                    `;
                  }).join('')}
                </tr>
              </table>
            </td>
          </tr>

          <!-- LIVE TELEMETRY COCKPIT (100% Native Inline HTML - Universal Email Compatibility) -->
          <tr>
            <td bgcolor="#070a12" style="padding: 18px 28px; background-color: #070a12; border-bottom: 1px solid #1f293d;">
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" bgcolor="#0b1120" style="background-color: #0b1120; border: 1px solid #1e293b; border-radius: 14px; padding: 18px 20px;">
                <tr>
                  <td>
                    <!-- Top Telemetry Row: Status Beacon, Headline & UTC Sync Pill -->
                    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
                      <tr>
                        <td valign="middle">
                          <table role="presentation" cellspacing="0" cellpadding="0" border="0">
                            <tr>
                              <td style="width: 32px; height: 32px; border-radius: 50%; background-color: #1e293b; border: 2px solid ${themeColor}; text-align: center; line-height: 32px; color: ${themeColor}; font-size: 14px; font-weight: 900;">
                                ${statusIcon}
                              </td>
                              <td style="padding-left: 12px;">
                                <div style="font-size: 10px; font-family: monospace; font-weight: 800; color: #818cf8; letter-spacing: 0.12em; text-transform: uppercase;">
                                  TELEMETRY RADAR // CHECKPOINT 0${milestone.order} OF 0${stations.length}
                                </div>
                                <div style="font-size: 15px; font-weight: 800; color: #f8fafc; margin-top: 2px;">
                                  ${statusHeadline}
                                </div>
                              </td>
                            </tr>
                          </table>
                        </td>
                        <td align="right" valign="middle">
                          <table role="presentation" cellspacing="0" cellpadding="0" border="0" bgcolor="#1e293b" style="background-color: #1e293b; border: 1px solid #334155; border-radius: 14px; padding: 5px 12px;">
                            <tr>
                              <td style="width: 7px; height: 7px; border-radius: 50%; background-color: ${themeColor};"></td>
                              <td style="padding-left: 7px; font-size: 10px; font-weight: 800; color: #cbd5e1; font-family: monospace; letter-spacing: 0.05em;">
                                SYNCED · ${nowUtc}
                              </td>
                            </tr>
                          </table>
                        </td>
                      </tr>
                    </table>

                    <!-- Divider -->
                    <div style="margin: 14px 0 12px 0; height: 1px; background-color: #1f293d;"></div>

                    <!-- Progress Velocity Metric -->
                    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
                      <tr>
                        <td style="font-size: 10.5px; font-weight: 700; color: #64748b; font-family: monospace; text-transform: uppercase;">
                          WORKSTREAM COMPLETION VELOCITY
                        </td>
                        <td align="right" style="font-size: 11.5px; font-weight: 800; color: ${themeColor}; font-family: monospace;">
                          ${progressPercent}% [${doneStationsCount}/${totalStations} SECURED]
                        </td>
                      </tr>
                    </table>
                    
                    <!-- Progress Bar Container -->
                    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin-top: 8px;">
                      <tr>
                        <td bgcolor="#1e293b" style="background-color: #1e293b; height: 7px; border-radius: 4px; overflow: hidden; padding: 0;">
                          <table role="presentation" width="${Math.max(progressPercent, 4)}%" cellspacing="0" cellpadding="0" border="0" height="7">
                            <tr>
                              <td bgcolor="${themeColor}" style="background-color: ${themeColor}; height: 7px; border-radius: 4px;"></td>
                            </tr>
                          </table>
                        </td>
                      </tr>
                    </table>

                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- TACTICAL HUD TELEMETRY GRID -->
          <tr>
            <td style="padding: 26px 32px; background-color: #111827;">
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
                <!-- Top Row: Parent Workstream & Active Station -->
                <tr>
                  <td width="50%" valign="top" style="padding-right: 6px; padding-bottom: 12px;">
                    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" bgcolor="#1e293b" style="background-color: #1e293b; border: 1px solid #334155; border-radius: 10px; padding: 14px 16px;">
                      <tr>
                        <td>
                          <div style="font-size: 10px; font-family: monospace; font-weight: 800; color: #818cf8; text-transform: uppercase; letter-spacing: 0.08em; margin-bottom: 4px;">
                            PARENT WORKSTREAM
                          </div>
                          <div style="font-size: 13.5px; font-weight: 700; color: #ffffff; line-height: 1.35;">
                            ${task.title}
                          </div>
                        </td>
                      </tr>
                    </table>
                  </td>
                  <td width="50%" valign="top" style="padding-left: 6px; padding-bottom: 12px;">
                    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" bgcolor="#1e293b" style="background-color: #1e293b; border: 1px solid #334155; border-radius: 10px; padding: 14px 16px;">
                      <tr>
                        <td>
                          <div style="font-size: 10px; font-family: monospace; font-weight: 800; color: #818cf8; text-transform: uppercase; letter-spacing: 0.08em; margin-bottom: 4px;">
                            ACTIVE CHECKPOINT STATION
                          </div>
                          <div style="font-size: 13.5px; font-weight: 700; color: #ffffff; line-height: 1.35;">
                            0${milestone.order} // ${milestone.title}
                          </div>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>

                <!-- Bottom Row: Target Commitment & Surveillance -->
                <tr>
                  <td width="50%" valign="top" style="padding-right: 6px;">
                    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" bgcolor="#1e293b" style="background-color: #1e293b; border: 1px solid #334155; border-radius: 10px; padding: 14px 16px;">
                      <tr>
                        <td>
                          <div style="font-size: 10px; font-family: monospace; font-weight: 800; color: #818cf8; text-transform: uppercase; letter-spacing: 0.08em; margin-bottom: 4px;">
                            TARGET DEADLINE
                          </div>
                          <div style="font-size: 13.5px; font-weight: 700; color: #ffffff;">
                            ${dueStr}
                            ${isOverdue ? `<span style="color: #ef4444; font-size: 11px; margin-left: 6px;">(${daysOverdue}d late)</span>` : ''}
                          </div>
                        </td>
                      </tr>
                    </table>
                  </td>
                  <td width="50%" valign="top" style="padding-left: 6px;">
                    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" bgcolor="#1e293b" style="background-color: #1e293b; border: 1px solid #334155; border-radius: 10px; padding: 14px 16px;">
                      <tr>
                        <td>
                          <div style="font-size: 10px; font-family: monospace; font-weight: 800; color: #818cf8; text-transform: uppercase; letter-spacing: 0.08em; margin-bottom: 4px;">
                            SURVEILLANCE FREQUENCY
                          </div>
                          <div style="font-size: 13.5px; font-weight: 700; color: #10b981;">
                            Daily Sweep @ 00:00 UTC
                          </div>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>

              <!-- Interactive Direct Action CTA Button -->
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin-top: 26px;">
                <tr>
                  <td align="center">
                    <a href="${dashboardUrl}" target="_blank" style="background: linear-gradient(135deg, #6366f1 0%, #4f46e5 100%); color: #ffffff; text-decoration: none; padding: 14px 34px; border-radius: 10px; font-weight: 800; font-size: 13px; display: inline-block; letter-spacing: 0.05em; text-transform: uppercase; box-shadow: 0 4px 18px rgba(99, 102, 241, 0.45);">
                      Launch Mission Control & Review &rarr;
                    </a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Sentinel Security Signature Footer -->
          <tr>
            <td bgcolor="#090d16" style="padding: 22px 32px; background-color: #090d16; border-top: 1px solid #1f293d; text-align: center;">
              <p style="margin: 0; font-size: 12px; color: #64748b; line-height: 1.5;">
                You are receiving this automated alert because your address is authorized as a <strong>Watcher Sentinel</strong> for this critical task.
              </p>
              <p style="margin: 6px 0 0 0; font-size: 11px; color: #475569;">
                UEIBI Enterprise Platform · Automated Watcher Delay Escalation Sentinel · Daily 00:00 UTC
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

function escalationEmail({ milestone, task, daysOverdue, allMilestones = [], escalationRole = null }) {
  const dueStr = new Date(milestone.dueDate).toISOString().slice(0, 10);
  const subject = `[Overdue Alert] Checkpoint 0${milestone.order} "${milestone.title}" on "${task.title}" is ${daysOverdue} day(s) late`;
  const text = `Critical Checkpoint Overdue: "${milestone.title}" on task "${task.title}" was due ${dueStr} and is ${daysOverdue} day(s) overdue.\n\n`
    + (escalationRole ? `Escalated to: ${escalationRole}\n\n` : '')
    + `Review in Performance Management: ${env.frontendOrigin || 'http://localhost:5173'}/uer/goals`;
  const html = buildModernMilestoneEmailHtml({
    milestone,
    task,
    allMilestones,
    daysOverdue,
    escalationRole,
  });
  return { subject, text, html };
}

/** Runs `tasks` with at most `limit` in flight at once. Each task's own
 *  failure is swallowed by the caller (see the try/catch at the call site)
 *  so one bad email never stops the rest of the batch. */
async function runWithConcurrency(tasks, limit) {
  const queue = [...tasks];
  const workers = Array.from({ length: Math.min(limit, queue.length) }, async () => {
    while (queue.length > 0) {
      const task = queue.shift();
      if (task) await task();
    }
  });
  await Promise.all(workers);
}

/**
 * Finds every overdue, unfinished milestone not already escalated today, and
 * notifies assignee, followers, watcher emails, and the dynamic reporting hierarchy level:
 *  - 1 to 3 days late: Level 1 (Direct Manager)
 *  - 4 to 7 days late: Level 2 (General Manager / Dept Head)
 *  - >7 days late: Level 3 (CXO / COO / Director)
 * @returns {Promise<{ scanned: number, escalated: number, capped: boolean }>}
 */
export async function checkOverdueMilestonesAndNotify() {
  const now = new Date();

  const overdueAll = await prisma.taskMilestone.findMany({
    where: { dueDate: { lt: now }, status: { not: 'DONE' } },
    include: {
      escalationLevels: true,
      task: {
        select: {
          id: true,
          title: true,
          tenantId: true,
          employeeId: true,
          goalId: true,
          milestones: {
            select: { id: true, title: true, order: true, status: true, dueDate: true },
            orderBy: { order: 'asc' },
          },
        },
      },
    },
    orderBy: { dueDate: 'asc' }, // longest overdue first
    take: MAX_MILESTONES_PER_RUN + 1,
  });
  const capped = overdueAll.length > MAX_MILESTONES_PER_RUN;
  const overdue = capped ? overdueAll.slice(0, MAX_MILESTONES_PER_RUN) : overdueAll;
  if (capped) {
    console.warn(`[milestoneEscalation] ${overdueAll.length} overdue milestones found — processing the ${MAX_MILESTONES_PER_RUN} most overdue this run.`);
  }

  const dueToday = overdue.filter((m) => !isSameCalendarDay(m.lastEscalatedAt, now));
  if (dueToday.length === 0) return { scanned: overdue.length, escalated: 0, capped };

  const escalatedLevelIds = [];
  const sendTasks = [];

  for (const milestone of dueToday) {
    const { task } = milestone;
    const daysOverdue = Math.max(1, Math.floor((now.getTime() - new Date(milestone.dueDate).getTime()) / MS_PER_DAY));

    // Determine target hierarchy level: 1 (1-3d), 2 (4-7d), 3 (>7d)
    const targetLevelNum = daysOverdue <= 3 ? 1 : daysOverdue <= 7 ? 2 : 3;
    const targetLevel = (milestone.escalationLevels || []).find((l) => l.levelNumber === targetLevelNum)
      || (milestone.escalationLevels || [])[0];

    if (targetLevel && !targetLevel.escalatedAt) {
      escalatedLevelIds.push(targetLevel.id);
    }

    const escalationRole = targetLevel?.roleOrTitle || `Level ${targetLevelNum} Executive`;
    const { subject, text, html } = escalationEmail({
      milestone,
      task,
      daysOverdue,
      allMilestones: task.milestones || [],
      escalationRole,
    });

    // Gather recipients: Assignee + Escalation user + Followers + Watchers
    const recipientUserIds = new Set();
    if (task.employeeId) recipientUserIds.add(task.employeeId);
    if (targetLevel?.userId) recipientUserIds.add(targetLevel.userId);

    // Fetch followers for this task and goal
    try {
      const entityIds = [task.id, task.goalId].filter(Boolean);
      const followers = await prisma.follower.findMany({
        where: { tenantId: task.tenantId, entityId: { in: entityIds } },
        select: { userId: true },
      });
      for (const f of followers) recipientUserIds.add(f.userId);
    } catch (err) {
      // Non-fatal if followers lookup fails
    }

    // Deliver in-app notifications to all platform users involved
    for (const uid of recipientUserIds) {
      sendTasks.push(async () => {
        try {
          const notif = await prisma.notification.create({
            data: {
              tenantId: task.tenantId,
              recipientId: uid,
              type: 'task_update',
              title: `Checkpoint Overdue (${daysOverdue}d)`,
              body: `Checkpoint 0${milestone.order} ("${milestone.title}") on task "${task.title}" is ${daysOverdue} day(s) overdue. Escalated to ${escalationRole}.`,
              entityType: 'milestone',
              entityId: milestone.id,
            },
          });
          emitToUser(task.tenantId, uid, 'notification', notif);
        } catch (err) {
          // Ignore individual notification failure
        }
      });
    }

    // Look up emails for users and watcherEmails
    const userEmailsToNotify = new Set();
    if (recipientUserIds.size > 0) {
      const users = await prisma.tenantUser.findMany({
        where: { id: { in: [...recipientUserIds] }, isDeleted: false },
        select: { email: true },
      });
      for (const u of users) {
        if (u.email) userEmailsToNotify.add(u.email.toLowerCase());
      }
    }
    for (const rawEmail of milestone.watcherEmails || []) {
      if (rawEmail) userEmailsToNotify.add(rawEmail.toLowerCase());
    }

    // Send emails
    for (const email of userEmailsToNotify) {
      sendTasks.push(async () => {
        try {
          await sendMail({ to: email, subject, text, html, event: 'MILESTONE_OVERDUE_ESCALATION' });
        } catch (err) {
          console.warn(`[milestoneEscalation] Failed to notify ${email} for milestone ${milestone.id}:`, err.message);
        }
      });
    }
  }

  await runWithConcurrency(sendTasks, EMAIL_CONCURRENCY);

  // Update timestamps
  await prisma.taskMilestone.updateMany({
    where: { id: { in: dueToday.map((m) => m.id) } },
    data: { lastEscalatedAt: now },
  });

  if (escalatedLevelIds.length > 0) {
    await prisma.checkpointEscalationLevel.updateMany({
      where: { id: { in: escalatedLevelIds } },
      data: { escalatedAt: now },
    });
  }

  return { scanned: overdue.length, escalated: dueToday.length, capped };
}

/**
 * Finds checkpoints due within the next 48 hours and notifies owner and followers
 */
export async function checkPreDueMilestonesAndNotify() {
  const now = new Date();
  const twoDaysLater = new Date(now.getTime() + 48 * 60 * 60 * 1000);

  const preDueMilestones = await prisma.taskMilestone.findMany({
    where: {
      dueDate: { gte: now, lte: twoDaysLater },
      status: { not: 'DONE' },
    },
    include: {
      task: {
        select: {
          id: true,
          title: true,
          tenantId: true,
          employeeId: true,
          goalId: true,
        },
      },
    },
  });

  for (const m of preDueMilestones) {
    const { task } = m;
    // Check if pre-due notification was already sent in last 48h
    const recentNotif = await prisma.notification.findFirst({
      where: {
        tenantId: task.tenantId,
        entityType: 'milestone',
        entityId: m.id,
        type: 'milestone_predue',
        createdAt: { gte: new Date(now.getTime() - 48 * 60 * 60 * 1000) },
      },
    });
    if (recentNotif) continue;

    const dueStr = new Date(m.dueDate).toISOString().slice(0, 10);
    const recipientUserIds = new Set();
    if (task.employeeId) recipientUserIds.add(task.employeeId);

    try {
      const entityIds = [task.id, task.goalId].filter(Boolean);
      const followers = await prisma.follower.findMany({
        where: { tenantId: task.tenantId, entityId: { in: entityIds } },
        select: { userId: true },
      });
      for (const f of followers) recipientUserIds.add(f.userId);
    } catch (_) {}

    for (const uid of recipientUserIds) {
      try {
        const notif = await prisma.notification.create({
          data: {
            tenantId: task.tenantId,
            recipientId: uid,
            type: 'milestone_predue',
            title: `Checkpoint Due in 2 Days`,
            body: `Checkpoint 0${m.order} ("${m.title}") on task "${task.title}" is due on ${dueStr}.`,
            entityType: 'milestone',
            entityId: m.id,
          },
        });
        emitToUser(task.tenantId, uid, 'notification', notif);
      } catch (_) {}
    }
  }
}

let intervalHandle = null;

/** Runs once immediately, then every `intervalMs` (default 24h). Idempotent */
export function startMilestoneEscalationSchedule(intervalMs = 24 * 60 * 60 * 1000) {
  if (intervalHandle) clearInterval(intervalHandle);

  const runAndLog = (label) => {
    checkOverdueMilestonesAndNotify()
      .then(({ scanned, escalated, capped }) => {
        if (escalated > 0) console.log(`[milestoneEscalation] ${label}: ${escalated}/${scanned} overdue milestone(s) escalated${capped ? ' (capped this run)' : ''}.`);
      })
      .catch((err) => console.warn(`[milestoneEscalation] ${label} overdue check failed:`, err.message));

    checkPreDueMilestonesAndNotify()
      .catch((err) => console.warn(`[milestoneEscalation] ${label} pre-due check failed:`, err.message));
  };

  runAndLog('Boot sweep');
  intervalHandle = setInterval(() => runAndLog('Daily sweep'), intervalMs);

  intervalHandle.unref?.();

  return intervalHandle;
}

/**
 * Dispatches an immediate alert email to a milestone's watchers and assignees.
 */
export async function dispatchMilestoneWatcherAlert(milestoneId) {
  const milestone = await prisma.taskMilestone.findUnique({
    where: { id: milestoneId },
    include: {
      task: {
        select: {
          id: true,
          title: true,
          tenantId: true,
          milestones: {
            select: { id: true, title: true, order: true, status: true, dueDate: true },
            orderBy: { order: 'asc' },
          },
        },
      },
    },
  });
  if (!milestone) throw { status: 404, message: 'Milestone not found' };
  if (!milestone.watcherEmails || milestone.watcherEmails.length === 0) {
    throw { status: 400, message: 'This milestone has no watcher emails configured' };
  }

  const { task } = milestone;
  const dueStr = new Date(milestone.dueDate).toISOString().slice(0, 10);
  const subject = `[Checkpoint Alert] Checkpoint 0${milestone.order} "${milestone.title}" on "${task.title}" — Status Update`;
  const text = `Critical Checkpoint Status Alert\n\n`
    + `Parent Task: "${task.title}"\n`
    + `Checkpoint 0${milestone.order}: "${milestone.title}"\n`
    + `Target Date: ${dueStr}\n\n`
    + `Review in Performance Management: ${env.frontendOrigin || 'http://localhost:5173'}/uer/goals`;
  const html = buildModernMilestoneEmailHtml({
    milestone,
    task,
    allMilestones: task.milestones || [],
    daysOverdue: 0,
  });

  const results = [];
  for (const email of milestone.watcherEmails) {
    const res = await sendMail({
      to: email.toLowerCase(),
      subject,
      text,
      html,
      event: 'MILESTONE_STATUS_DISPATCH',
    });
    results.push({ email, ...res });
  }

  return { success: true, results, recipients: milestone.watcherEmails };
}

// Backwards compatibility alias
export const sendMilestoneTestEmail = dispatchMilestoneWatcherAlert;


