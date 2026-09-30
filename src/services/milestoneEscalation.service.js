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
 */
import { prisma } from '../lib/prisma.js';
import { sendMail } from '../lib/mailer.js';
import { emitToUser } from '../lib/socket.js';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function isSameCalendarDay(a, b) {
  if (!a || !b) return false;
  const da = new Date(a);
  const db = new Date(b);
  return da.getUTCFullYear() === db.getUTCFullYear()
    && da.getUTCMonth() === db.getUTCMonth()
    && da.getUTCDate() === db.getUTCDate();
}

async function notifyWatcher({ tenantId, email, milestone, task, daysOverdue }) {
  const subject = `[Overdue] Milestone "${milestone.title}" on "${task.title}" is ${daysOverdue} day(s) late`;
  const text = `Milestone "${milestone.title}" (task: "${task.title}") was due `
    + `${new Date(milestone.dueDate).toISOString().slice(0, 10)} and is not yet complete — `
    + `${daysOverdue} day(s) overdue.`;
  const html = `<div style="font-family: sans-serif; padding: 16px; line-height: 1.6;">
    <h3 style="color:#b91c1c;">Milestone overdue</h3>
    <p><strong>Task:</strong> ${task.title}</p>
    <p><strong>Milestone:</strong> ${milestone.title}</p>
    <p><strong>Due:</strong> ${new Date(milestone.dueDate).toISOString().slice(0, 10)} (${daysOverdue} day(s) ago)</p>
    <p>This will keep escalating daily until the milestone is completed or rescheduled.</p>
  </div>`;

  await sendMail({ to: email, subject, text, html, event: 'MILESTONE_OVERDUE_ESCALATION' });

  // Also drop a dashboard Notification for any watcher who happens to be a
  // platform user in this tenant — a watcher email need not be one.
  const watcherUser = await prisma.tenantUser.findFirst({
    where: { tenantId, email: email.toLowerCase(), isDeleted: false },
    select: { id: true },
  });
  if (watcherUser) {
    const notif = await prisma.notification.create({
      data: {
        tenantId,
        recipientId: watcherUser.id,
        type: 'task_update',
        title: 'Milestone overdue',
        body: `"${milestone.title}" on "${task.title}" is ${daysOverdue} day(s) overdue.`,
        entityType: 'milestone',
        entityId: milestone.id,
      },
    });
    emitToUser(tenantId, watcherUser.id, 'notification', notif);
  }
}

/**
 * Finds every overdue, unfinished milestone not already escalated today, and
 * emails its watchers + notifies any of them who are also platform users.
 * @returns {Promise<{ scanned: number, escalated: number }>}
 */
export async function checkOverdueMilestonesAndNotify() {
  const now = new Date();
  const overdue = await prisma.taskMilestone.findMany({
    where: { dueDate: { lt: now }, status: { not: 'DONE' } },
    include: { task: { select: { id: true, title: true, tenantId: true } } },
  });

  let escalated = 0;
  for (const milestone of overdue) {
    if (isSameCalendarDay(milestone.lastEscalatedAt, now)) continue;
    if (!milestone.watcherEmails || milestone.watcherEmails.length === 0) continue;

    const daysOverdue = Math.max(1, Math.floor((now.getTime() - new Date(milestone.dueDate).getTime()) / MS_PER_DAY));

    for (const email of milestone.watcherEmails) {
      try {
        await notifyWatcher({ tenantId: milestone.task.tenantId, email, milestone, task: milestone.task, daysOverdue });
      } catch (err) {
        console.warn(`[milestoneEscalation] Failed to notify watcher ${email} for milestone ${milestone.id}:`, err.message);
      }
    }

    await prisma.taskMilestone.update({
      where: { id: milestone.id },
      data: { lastEscalatedAt: now },
    });
    escalated += 1;
  }

  return { scanned: overdue.length, escalated };
}

let intervalHandle = null;

/** Runs once immediately, then every `intervalMs` (default 24h). Idempotent —
 *  calling it twice clears the previous interval rather than doubling up. */
export function startMilestoneEscalationSchedule(intervalMs = 24 * 60 * 60 * 1000) {
  if (intervalHandle) clearInterval(intervalHandle);

  checkOverdueMilestonesAndNotify()
    .then(({ scanned, escalated }) => {
      if (escalated > 0) console.log(`[milestoneEscalation] Boot sweep: ${escalated}/${scanned} overdue milestone(s) escalated.`);
    })
    .catch((err) => console.warn('[milestoneEscalation] Boot sweep failed:', err.message));

  intervalHandle = setInterval(() => {
    checkOverdueMilestonesAndNotify()
      .then(({ scanned, escalated }) => {
        if (escalated > 0) console.log(`[milestoneEscalation] Daily sweep: ${escalated}/${scanned} overdue milestone(s) escalated.`);
      })
      .catch((err) => console.warn('[milestoneEscalation] Daily sweep failed:', err.message));
  }, intervalMs);

  // Never keep the process alive on its own — same courtesy as any other
  // background timer in a server that otherwise exits cleanly.
  intervalHandle.unref?.();

  return intervalHandle;
}
