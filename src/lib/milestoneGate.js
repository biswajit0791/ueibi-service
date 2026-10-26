/**
 * milestoneGate.js
 *
 * When may a milestone be approved, and when may work be recorded on it?
 * Pure, so every rule can be unit tested without a database.
 *
 * The order of a critical task is:
 *   goal activated → task weights total 100% → manager approves the milestone
 *   → the assignee works it (progress / complete)
 *
 * so a milestone is frozen for BOTH the manager and the assignee until the
 * goal is active and its execution is unlocked, and frozen for the assignee
 * until the manager has approved it (when the company requires approval).
 *
 * This is deliberately stricter than plain tasks, whose gate only waits for
 * goal approval (see assertGoalUnlocked): a milestone is a dated commitment
 * against the goal's plan, and that plan is not final until it totals 100%.
 */

export const MILESTONE_GATE = {
  GOAL_NOT_ACTIVE: 'GOAL_NOT_ACTIVE',
  GOAL_WEIGHT_INCOMPLETE: 'GOAL_WEIGHT_INCOMPLETE',
  MILESTONE_NOT_APPROVED: 'MILESTONE_NOT_APPROVED',
};

const GOAL_NOT_ACTIVE_STATUSES = ['PENDING_APPROVAL', 'DRAFT'];

/** Approved at some point: a later reschedule request does not un-approve it. */
export function isMilestoneApproved(milestone) {
  return ['APPROVED', 'DONE'].includes(milestone?.status) || Boolean(milestone?.approvedById);
}

/**
 * @param {object} p
 * @param {'approve'|'work'} p.action - approving it, or changing its progress / done state
 * @param {object|null} p.goal - the parent goal ({ status }), null for goal-less or standalone work
 * @param {object|null} p.weightSummary - goalWeightSummary() of that goal
 * @param {object} p.milestone
 * @param {boolean} p.requireApproval - TenantSettings.milestoneRequireApproval
 * @returns {{ code: string, message: string } | null} why it is refused, or null
 */
export function milestoneBlock({ action, goal, weightSummary, milestone, requireApproval }) {
  const verb = action === 'approve' ? 'approved' : 'updated';

  if (goal) {
    if (GOAL_NOT_ACTIVE_STATUSES.includes(String(goal.status || '').toUpperCase())) {
      return {
        code: MILESTONE_GATE.GOAL_NOT_ACTIVE,
        message: `Milestones can't be ${verb} until the goal is activated.`,
      };
    }
    if (weightSummary?.locked) {
      const total = Number(weightSummary.totalWeight || 0);
      return {
        code: MILESTONE_GATE.GOAL_WEIGHT_INCOMPLETE,
        message: `Milestones can't be ${verb} until the goal's task weights total 100% (currently ${total}%).`,
      };
    }
  }

  if (action === 'work' && requireApproval && !isMilestoneApproved(milestone)) {
    return {
      code: MILESTONE_GATE.MILESTONE_NOT_APPROVED,
      message: 'This milestone needs manager approval before its progress can be updated.',
    };
  }
  return null;
}
