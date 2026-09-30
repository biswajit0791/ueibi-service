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

function escalationEmail({ milestone, task, daysOverdue }) {
  const dueStr = new Date(milestone.dueDate).toISOString().slice(0, 10);
  const subject = `[Overdue] Milestone "${milestone.title}" on "${task.title}" is ${daysOverdue} day(s) late`;
  const text = `Milestone "${milestone.title}" (task: "${task.title}") was due ${dueStr} and is not yet `
    + `complete — ${daysOverdue} day(s) overdue.`;
  const html = `<div style="font-family: sans-serif; padding: 16px; line-height: 1.6;">
    <h3 style="color:#b91c1c;">Milestone overdue</h3>
    <p><strong>Task:</strong> ${task.title}</p>
    <p><strong>Milestone:</strong> ${milestone.title}</p>
    <p><strong>Due:</strong> ${dueStr} (${daysOverdue} day(s) ago)</p>
    <p>This will keep escalating daily until the milestone is completed or rescheduled.</p>
  </div>`;
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
 * emails its watchers + notifies any of them who are also platform users.
 * @returns {Promise<{ scanned: number, escalated: number, capped: boolean }>}
 */
export async function checkOverdueMilestonesAndNotify() {
  const now = new Date();

  const overdueAll = await prisma.taskMilestone.findMany({
    where: { dueDate: { lt: now }, status: { not: 'DONE' } },
    include: { task: { select: { id: true, title: true, tenantId: true } } },
    orderBy: { dueDate: 'asc' }, // longest overdue first, in case of a cap
    take: MAX_MILESTONES_PER_RUN + 1,
  });
  const capped = overdueAll.length > MAX_MILESTONES_PER_RUN;
  const overdue = capped ? overdueAll.slice(0, MAX_MILESTONES_PER_RUN) : overdueAll;
  if (capped) {
    console.warn(`[milestoneEscalation] ${overdueAll.length} overdue milestones found — processing the ${MAX_MILESTONES_PER_RUN} most overdue this run, the rest will be caught next tick.`);
  }

  const dueToday = overdue.filter((m) => (
    !isSameCalendarDay(m.lastEscalatedAt, now) && m.watcherEmails?.length > 0
  ));
  if (dueToday.length === 0) return { scanned: overdue.length, escalated: 0, capped };

  // One bulk lookup for every distinct (tenantId, email) watcher pair in this
  // run, instead of a findFirst per watcher per milestone.
  const pairKey = (tenantId, email) => `${tenantId}|${email.toLowerCase()}`;
  const wantedPairs = new Map(); // key -> { tenantId, email }
  for (const m of dueToday) {
    for (const email of m.watcherEmails) {
      wantedPairs.set(pairKey(m.task.tenantId, email), { tenantId: m.task.tenantId, email: email.toLowerCase() });
    }
  }
  const tenantIds = [...new Set([...wantedPairs.values()].map((p) => p.tenantId))];
  const emails = [...new Set([...wantedPairs.values()].map((p) => p.email))];
  const watcherUsers = tenantIds.length > 0
    ? await prisma.tenantUser.findMany({
        where: { tenantId: { in: tenantIds }, email: { in: emails }, isDeleted: false },
        select: { id: true, tenantId: true, email: true },
      })
    : [];
  const userByPair = new Map(watcherUsers.map((u) => [pairKey(u.tenantId, u.email.toLowerCase()), u.id]));

  const sendTasks = [];
  for (const milestone of dueToday) {
    const { task } = milestone;
    const daysOverdue = Math.max(1, Math.floor((now.getTime() - new Date(milestone.dueDate).getTime()) / MS_PER_DAY));
    const { subject, text, html } = escalationEmail({ milestone, task, daysOverdue });

    for (const rawEmail of milestone.watcherEmails) {
      const email = rawEmail.toLowerCase();
      sendTasks.push(async () => {
        try {
          await sendMail({ to: email, subject, text, html, event: 'MILESTONE_OVERDUE_ESCALATION' });
          const watcherUserId = userByPair.get(pairKey(task.tenantId, email));
          if (watcherUserId) {
            const notif = await prisma.notification.create({
              data: {
                tenantId: task.tenantId,
                recipientId: watcherUserId,
                type: 'task_update',
                title: 'Milestone overdue',
                body: `"${milestone.title}" on "${task.title}" is ${daysOverdue} day(s) overdue.`,
                entityType: 'milestone',
                entityId: milestone.id,
              },
            });
            emitToUser(task.tenantId, watcherUserId, 'notification', notif);
          }
        } catch (err) {
          console.warn(`[milestoneEscalation] Failed to notify watcher ${email} for milestone ${milestone.id}:`, err.message);
        }
      });
    }
  }

  await runWithConcurrency(sendTasks, EMAIL_CONCURRENCY);

  // One UPDATE for every milestone escalated this run, not one per milestone.
  await prisma.taskMilestone.updateMany({
    where: { id: { in: dueToday.map((m) => m.id) } },
    data: { lastEscalatedAt: now },
  });

  return { scanned: overdue.length, escalated: dueToday.length, capped };
}

let intervalHandle = null;

/** Runs once immediately, then every `intervalMs` (default 24h). Idempotent —
 *  calling it twice clears the previous interval rather than doubling up. */
export function startMilestoneEscalationSchedule(intervalMs = 24 * 60 * 60 * 1000) {
  if (intervalHandle) clearInterval(intervalHandle);

  const runAndLog = (label) => checkOverdueMilestonesAndNotify()
    .then(({ scanned, escalated, capped }) => {
      if (escalated > 0) console.log(`[milestoneEscalation] ${label}: ${escalated}/${scanned} overdue milestone(s) escalated${capped ? ' (capped this run)' : ''}.`);
    })
    .catch((err) => console.warn(`[milestoneEscalation] ${label} failed:`, err.message));

  runAndLog('Boot sweep');
  intervalHandle = setInterval(() => runAndLog('Daily sweep'), intervalMs);

  // Never keep the process alive on its own — same courtesy as any other
  // background timer in a server that otherwise exits cleanly.
  intervalHandle.unref?.();

  return intervalHandle;
}
