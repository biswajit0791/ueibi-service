/**
 * workflowStatus.js
 *
 * Canonical status vocabularies for Goals, Goal Assignments and Tasks.
 * The Prisma `status` columns are free-form strings, so these lists are the
 * only guardrail. Keep schema.prisma comments in sync with these.
 */

// ── Goal / GoalAssignment lifecycle ────────────────────────────────────────
// DRAFT → IN_PROGRESS → READY_FOR_SUBMISSION → PENDING_MANAGER_REVIEW
//   → PENDING_HR_REVIEW → COMPLETED
// CHANGES_REQUESTED / REJECTED are returned states that route back to the employee.
export const GOAL_STATUSES = [
  'DRAFT',
  'IN_PROGRESS',
  'READY_FOR_SUBMISSION',
  'PENDING_MANAGER_REVIEW',
  'PENDING_HR_REVIEW',
  'CHANGES_REQUESTED',
  'REJECTED',
  'COMPLETED',
];

// Statuses a plain edit (PATCH /goals/:id) is allowed to set directly.
// Anything that advances the review workflow must go through the dedicated
// /submit, /approve, /reject, /hr-approve, /hr-reject, /resubmit endpoints.
export const GOAL_EDITABLE_STATUSES = ['DRAFT', 'IN_PROGRESS'];

// ── Task lifecycle ────────────────────────────────────────────────────────
export const TASK_STATUSES = [
  'todo',
  'in_progress',
  'pending_on_others',
  'in_review',
  'done',
  'pending_approval',
  'rejected',
];

export function isValidTaskStatus(status) {
  return status === undefined || status === null || TASK_STATUSES.includes(status);
}
