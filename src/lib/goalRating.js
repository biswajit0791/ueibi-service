/**
 * Goal-owner rating gate.
 *
 * Individual tasks may be accepted (marked done) one at a time, but the owner
 * may only rate them once every task of the goal is completed/approved.
 */
const DONE_STATUSES = new Set(['done', 'completed', 'approved']);

export function isTaskSettled(task) {
  return DONE_STATUSES.has(String(task?.status || '').toLowerCase());
}

/** @returns {{ ready: boolean, total: number, remaining: number }} */
export function goalRatingGate(tasks) {
  const list = Array.isArray(tasks) ? tasks : [];
  const remaining = list.filter((t) => !isTaskSettled(t)).length;
  return { ready: list.length > 0 && remaining === 0, total: list.length, remaining };
}
