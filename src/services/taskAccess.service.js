import { prisma } from '../lib/prisma.js';
import { ELEVATED_ROLES, MANAGER_OR_ELEVATED_ROLES, hasRole } from '../lib/roles.js';
import { goalService } from './goal.service.js';

/**
 * Single source of truth for "can this user see / act on this task".
 *
 * Previously task.controller (`assertTaskOwner`) and taskActivity.controller
 * (`verifyTaskAccess`) each had their own slightly different copy — one
 * upper-cased roles, the other didn't; one had a manager-chain fallback, the
 * other only checked direct reports.
 *
 * Access is granted when the caller is:
 *  - an elevated role (SUPER_ADMIN / ADMIN / CMD / HR)
 *  - the assigned employee
 *  - a manager anywhere up the reporting chain of the assigned employee
 *  - anyone who may act on the GOAL the task belongs to
 *  - a line manager whose reach covers the assignee (same rule as elsewhere)
 *  - (for companion dependency tasks) the owner/manager of the parent task
 *
 * @returns {Promise<object>} the task record
 * @throws {{status:number,message:string}}
 */
export async function loadTaskForUser(taskId, user, tenantId) {
  const task = await prisma.task.findFirst({ where: { id: taskId, tenantId } });
  if (!task) {
    throw { status: 404, message: 'Task not found' };
  }

  if (hasRole(user.role, ELEVATED_ROLES)) return task;
  if (task.employeeId === user.id) return task;

  if (task.employeeId && await goalService.isSubordinate(user.id, task.employeeId, tenantId)) {
    return task;
  }

  // If the caller may act on the GOAL, they may act on its tasks. Without
  // this, a manager could open a goal, approve it and edit it, yet be refused
  // on every task inside it — because this function accepted only the
  // managerId chain while the goal rules have always used a wider reach, and
  // most employees here have no manager set at all.
  if (task.goalId) {
    const goal = await prisma.goal.findFirst({
      where: { id: task.goalId, tenantId },
      include: { assignments: { select: { employeeId: true } } },
    });
    if (goal && await goalService.canAccessGoal(goal, user, tenantId)) return task;
  }

  // The same reach over a STANDALONE task, which has no goal to defer to:
  // a manager covers their department and anyone without an explicit manager,
  // but never a peer manager or anyone above them.
  if (String(user.role || '').toUpperCase() === 'MANAGER' && task.employeeId) {
    const [caller, target] = await Promise.all([
      prisma.tenantUser.findUnique({ where: { id: user.id }, select: { department: true } }),
      prisma.tenantUser.findFirst({
        where: { id: task.employeeId, tenantId },
        select: { role: true, department: true, managerId: true },
      }),
    ]);
    if (target && !hasRole(target.role, MANAGER_OR_ELEVATED_ROLES)) {
      const sameDept = caller?.department && target.department === caller.department;
      if (sameDept || !target.managerId) return task;
    }
  }

  if (task.isDependencyOf) {
    const parent = await prisma.task.findFirst({ where: { id: task.isDependencyOf, tenantId } });
    if (parent) {
      if (parent.employeeId === user.id) return task;
      if (parent.employeeId && await goalService.isSubordinate(user.id, parent.employeeId, tenantId)) {
        return task;
      }
    }
  }

  throw { status: 403, message: "Access forbidden: you are not authorized to act on this task" };
}

/** Extract the companion ("dependency") task id regardless of which key the client used. */
export function getCompanionTaskId(dependency) {
  if (!dependency || typeof dependency !== 'object') return null;
  return dependency.depTaskId || dependency.createdTaskId || dependency.createdTaskID || null;
}
