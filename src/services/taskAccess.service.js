import { prisma } from '../lib/prisma.js';
import { ELEVATED_ROLES, hasRole } from '../lib/roles.js';
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
