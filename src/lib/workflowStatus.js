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

// Statuses in which a plain edit (PATCH /goals/:id) is allowed.
//
// The point of this list is to stop a goal being rewritten underneath a
// reviewer who is midway through assessing it. It is NOT meant to freeze a
// goal that is simply being worked on — but it did: ACTIVE, the normal state
// of an approved goal, was missing, so editing one returned 409 for everyone
// below HR. A manager could not so much as fix a typo on a goal they had just
// approved.
//
// Editable: the goal is being planned, proposed or worked on.
// Locked: a reviewer holds it, or it is finished.
export const GOAL_EDITABLE_STATUSES = [
  'DRAFT',
  'PENDING_APPROVAL',
  'ACTIVE',
  'IN_PROGRESS',
  'READY_FOR_SUBMISSION',
  'CHANGES_REQUESTED',
  'REJECTED',
];

// Deliberately absent from the list above, and why:
//   PENDING_MANAGER_REVIEW / PENDING_HR_REVIEW - a reviewer is looking at it
//   COMPLETED                                  - it is done
export const GOAL_REVIEW_LOCKED_STATUSES = [
  'PENDING_MANAGER_REVIEW',
  'PENDING_HR_REVIEW',
  'COMPLETED',
];

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
