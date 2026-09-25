/**
 * goalWeight.service.js
 *
 * The one authority on goal task weighting.
 *
 * Rule: the tasks under a goal must total exactly 100% before any of them can
 * be worked on. Until then the goal's execution is locked — statuses stay at
 * 'todo' and progress stays at 0.
 *
 * Every total here is summed from the database. Nothing the client sends about
 * weights — a computed total, a hidden field, a request-body `totalWeight` —
 * is read or trusted, because the lock is the only thing standing between a
 * half-planned goal and work being logged against it.
 *
 * Grandfathering: goals whose work had already begun when this rule arrived
 * carry `weightLockExempt` and are never locked. Applying the rule to them
 * retroactively would have frozen 28 live goals mid-cycle, two of which are
 * over 100% and could not be fixed by adding tasks at all.
 */
import { prisma } from '../lib/prisma.js';
import { isWorkStarted, isWorkComplete } from '../lib/taskTiming.js';

export const REQUIRED_TOTAL = 100;

/** Tasks that count towards a goal's total. A standalone task is not part of
 *  the goal's plan even if it still carries the goalId. */
const countsTowardsTotal = (t) => !t.isStandalone;

/**
 * The weight position of one goal.
 *
 * @param {string} goalId
 * @param {object} [client] - a transaction client, when called inside one
 * @returns {Promise<object|null>} null when the goal does not exist
 */
export async function goalWeightSummary(goalId, client = prisma) {
  if (!goalId) return null;

  const goal = await client.goal.findUnique({
    where: { id: goalId },
    select: {
      id: true,
      title: true,
      weightLockExempt: true,
      status: true,
      tasks: {
        select: {
          id: true, title: true, weight: true, status: true,
          progress: true, isStandalone: true, employeeId: true,
        },
      },
    },
  });
  if (!goal) return null;

  const tasks = goal.tasks.filter(countsTowardsTotal);
  const totalWeight = tasks.reduce((sum, t) => sum + Number(t.weight || 0), 0);
  const isComplete = totalWeight === REQUIRED_TOTAL;
  const exempt = goal.weightLockExempt === true;

  // A goal still waiting for a manager to agree to it is not work yet. The
  // employee may plan it out — adding tasks and weights is how the manager
  // sees what they are approving — but nothing can be started. This rides on
  // the weight lock rather than becoming a second gate, so every endpoint that
  // already refuses unweighted work refuses unapproved work too.
  const awaitingApproval = goal.status === 'PENDING_APPROVAL';
  const locked = awaitingApproval || (!exempt && !isComplete);

  return {
    goalId: goal.id,
    awaitingApproval,
    taskCount: tasks.length,
    totalWeight,
    requiredTotal: REQUIRED_TOTAL,
    remaining: REQUIRED_TOTAL - totalWeight,      // negative when over-allocated
    isComplete,
    overAllocated: totalWeight > REQUIRED_TOTAL,
    exempt,
    locked,
    // Derived, never stored: a goal whose task structure is valid enough for
    // work to begin. It says nothing about whether the goal is finished — that
    // is `progress`, which the existing weighted calculation still owns.
    readiness: locked ? 'NOT_READY' : 'READY',
    workStarted: tasks.some(isWorkStarted),
    completedCount: tasks.filter(isWorkComplete).length,
    reason: lockReason({ locked, exempt, totalWeight, taskCount: tasks.length, awaitingApproval }),
    tasks: tasks.map((t) => ({
      id: t.id, title: t.title, weight: Number(t.weight || 0),
      status: t.status, employeeId: t.employeeId,
    })),
  };
}

function lockReason({ locked, exempt, totalWeight, taskCount, awaitingApproval }) {
  if (awaitingApproval) {
    return 'This goal is waiting for manager approval. You can plan its tasks and weights, but work cannot start until it is approved.';
  }
  if (exempt) return 'This goal was already under way before task weighting was introduced, so it is exempt from the 100% rule.';
  if (!locked) return 'Task weights total 100%. Execution is unlocked.';
  if (taskCount === 0) return 'This goal has no tasks yet. Add tasks totalling 100% to unlock execution.';
  if (totalWeight > REQUIRED_TOTAL) {
    return `Task weights total ${totalWeight}%, which is ${totalWeight - REQUIRED_TOTAL}% over. Reduce them to exactly 100% to unlock execution.`;
  }
  return `Task weights total ${totalWeight}%. Allocate the remaining ${REQUIRED_TOTAL - totalWeight}% to unlock execution.`;
}

/**
 * Throws 409 unless the goal's execution is unlocked.
 * A task with no goal is never locked — standalone work has no plan to total.
 */
export async function assertGoalUnlocked(goalId, client = prisma) {
  if (!goalId) return null;
  const summary = await goalWeightSummary(goalId, client);
  if (!summary) return null;
  if (summary.locked) {
    throw {
      status: 409,
      // Two different reasons for the same refusal, and the UI wording differs:
      // one asks the employee to fix weights, the other to wait for a manager.
      code: summary.awaitingApproval ? 'GOAL_AWAITING_APPROVAL' : 'GOAL_WEIGHT_INCOMPLETE',
      message: summary.reason,
      weightSummary: summary,
    };
  }
  return summary;
}

/**
 * Would this weight change push the goal past 100%? Throws 400 if so.
 *
 * `excludeTaskId` drops the task being edited out of the existing total, so an
 * edit is measured against its siblings rather than against itself.
 * `copies` covers the create-for-several-assignees path, where one form
 * submission produces one task per assignee and each carries the full weight.
 *
 * Exempt goals are not checked: two of them are already over 100 and blocking
 * edits there would freeze the very goals grandfathering exists to protect.
 */
export async function assertWeightFits({
  goalId, weight, excludeTaskId = null, copies = 1, client = prisma,
}) {
  if (!goalId || weight === undefined || weight === null) return null;

  const summary = await goalWeightSummary(goalId, client);
  if (!summary || summary.exempt) return summary;

  const others = summary.tasks
    .filter((t) => t.id !== excludeTaskId)
    .reduce((sum, t) => sum + t.weight, 0);
  const adding = Number(weight) * Math.max(1, copies);
  const projected = others + adding;

  if (projected > REQUIRED_TOTAL) {
    const each = Number(weight);
    throw {
      status: 400,
      code: 'GOAL_WEIGHT_EXCEEDED',
      message: copies > 1
        ? `Task weights for this goal would total ${projected}%. The other tasks account for ${others}%, and ${each}% × ${copies} assignees adds ${adding}%. Only ${REQUIRED_TOTAL - others}% remains.`
        : `Task weights for this goal would total ${projected}%, which exceeds 100%. The other tasks account for ${others}%, so at most ${REQUIRED_TOTAL - others}% is available.`,
      available: REQUIRED_TOTAL - others,
    };
  }
  return summary;
}

/**
 * The weight to give a new task when the caller did not specify one.
 *
 * The column default is 1, which is a hangover from when weight was a rough
 * ranking rather than a percentage: three tasks defaulting that way total 3%
 * and the goal can never unlock. Defaulting to what is left of 100 means a
 * goal cannot silently become unreachable through the API.
 */
export async function defaultWeightFor(goalId, copies = 1, client = prisma) {
  if (!goalId) return 1;                       // standalone work has no share
  const summary = await goalWeightSummary(goalId, client);
  if (!summary) return 1;
  const remaining = summary.remaining;
  if (remaining <= 0) return 1;
  return Math.max(1, Math.floor(remaining / Math.max(1, copies)));
}

/**
 * Run a weight-changing write inside a serialisable transaction and re-check
 * the goal's total before committing.
 *
 * The check-then-write in `assertWeightFits` is not enough on its own: two
 * requests can both read a total of 80, both decide their +20 fits, and both
 * commit, leaving 120. Re-summing inside the transaction closes that — under
 * SERIALIZABLE, PostgreSQL aborts one of the two conflicting transactions, and
 * whichever commits second sees the other's rows and is rejected.
 *
 * P2034 is Prisma's serialisation-conflict code. It means "nothing was
 * written, try again", so a couple of retries are safe and invisible to the
 * caller. Everything else propagates untouched.
 */
export async function withWeightGuard(goalId, fn, { retries = 3 } = {}) {
  if (!goalId) return fn(prisma);

  for (let attempt = 0; ; attempt += 1) {
    try {
      return await prisma.$transaction(async (tx) => {
        const result = await fn(tx);

        const summary = await goalWeightSummary(goalId, tx);
        if (summary && !summary.exempt && summary.totalWeight > REQUIRED_TOTAL) {
          // Throwing rolls the whole transaction back, so the write above never
          // lands. This is the guarantee; the pre-check is only there to give a
          // better message in the ordinary, uncontended case.
          throw {
            status: 400,
            code: 'GOAL_WEIGHT_EXCEEDED',
            message: `Task weights for this goal would total ${summary.totalWeight}%, which exceeds 100%. Another change to this goal was saved at the same time — reload and try again.`,
            available: 0,
          };
        }
        return result;
      }, { isolationLevel: 'Serializable' });
    } catch (e) {
      if (e?.code === 'P2034' && attempt < retries) continue;
      throw e;
    }
  }
}

/** Attach a weight summary to each of several goals in one query. */
export async function summariseGoals(goalIds, client = prisma) {
  const ids = [...new Set((goalIds || []).filter(Boolean))];
  if (!ids.length) return {};
  const goals = await client.goal.findMany({
    where: { id: { in: ids } },
    select: {
      id: true, weightLockExempt: true, status: true,
      tasks: { select: { id: true, weight: true, status: true, progress: true, isStandalone: true } },
    },
  });
  const out = {};
  for (const goal of goals) {
    const tasks = goal.tasks.filter(countsTowardsTotal);
    const totalWeight = tasks.reduce((sum, t) => sum + Number(t.weight || 0), 0);
    const isComplete = totalWeight === REQUIRED_TOTAL;
    const exempt = goal.weightLockExempt === true;
    const awaitingApproval = goal.status === 'PENDING_APPROVAL';
    const locked = awaitingApproval || (!exempt && !isComplete);
    out[goal.id] = {
      goalId: goal.id,
      awaitingApproval,
      taskCount: tasks.length,
      totalWeight,
      requiredTotal: REQUIRED_TOTAL,
      remaining: REQUIRED_TOTAL - totalWeight,
      isComplete,
      overAllocated: totalWeight > REQUIRED_TOTAL,
      exempt,
      locked,
      readiness: locked ? 'NOT_READY' : 'READY',
      reason: lockReason({ locked, exempt, totalWeight, taskCount: tasks.length, awaitingApproval }),
    };
  }
  return out;
}
