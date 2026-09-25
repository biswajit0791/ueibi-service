/**
 * taskVisibility.service.js
 *
 * "Which tasks may this user see?" — as a Prisma `where`, in one place.
 *
 * This logic lived inside listTasks. The sub-task board needs exactly the same
 * answer (it shows sub-tasks of the tasks you can see), and copying it would
 * have made a second rule free to drift from the first. Three separate bugs in
 * this module have already come from access rules that were duplicated and
 * then diverged, so it is extracted rather than repeated.
 *
 * Returns either `{ where }` or `{ error: { status, message } }`. The caller
 * decides what to do with a refusal; this function never touches `res`.
 */
import { prisma } from '../lib/prisma.js';
import { ELEVATED_ROLES, hasRole } from '../lib/roles.js';
import { goalService } from './goal.service.js';

export async function visibleTaskWhere({ user, tenantId, employeeId, fy }) {
  const targetEmployeeId = employeeId || user.id;
  const callerRole = String(user.role || '').toUpperCase();
  const isElevated = hasRole(user.role, ELEVATED_ROLES);

  // A regular employee only ever sees their own tasks.
  if (callerRole === 'EMPLOYEE' && !isElevated) {
    if (targetEmployeeId !== 'all' && targetEmployeeId !== user.id) {
      return { error: { status: 403, message: 'Access forbidden: employees can only view their own tasks' } };
    }
    return {
      where: {
        tenantId,
        employeeId: user.id,
        ...(fy ? { financialYear: fy } : {}),
      },
    };
  }

  // The whole board.
  if (targetEmployeeId === 'all') {
    const where = { tenantId, ...(fy ? { financialYear: fy } : {}) };
    if (isElevated) return { where };

    // Manager: themselves, their whole downline, same-department employees,
    // and the companion dependency tasks hanging off any of those.
    const people = await prisma.tenantUser.findMany({
      where: { tenantId, isDeleted: false },
      select: { id: true, managerId: true, department: true, role: true },
    });
    const childrenOf = {};
    people.forEach((u) => { if (u.managerId) (childrenOf[u.managerId] ||= []).push(u.id); });

    const allowedIds = new Set([user.id]);
    const queue = [user.id];
    while (queue.length) {
      const cur = queue.shift();
      for (const child of childrenOf[cur] || []) {
        if (!allowedIds.has(child)) { allowedIds.add(child); queue.push(child); }
      }
    }
    if (user.department) {
      people.forEach((u) => {
        if (u.department === user.department
            && ['EMPLOYEE', 'STUDENT'].includes(String(u.role || '').toUpperCase())) {
          allowedIds.add(u.id);
        }
      });
    }

    const allowedIdList = [...allowedIds];
    const visibleParents = await prisma.task.findMany({
      where: { tenantId, employeeId: { in: allowedIdList } },
      select: { id: true },
    });
    where.OR = [
      { employeeId: { in: allowedIdList } },
      { isDependencyOf: { in: visibleParents.map((t) => t.id) } },
    ];
    return { where };
  }

  // One named person's board.
  if (targetEmployeeId !== user.id && !isElevated) {
    const targetUser = await prisma.tenantUser.findFirst({
      where: { id: targetEmployeeId, tenantId, isDeleted: false },
      select: { id: true, role: true, department: true, managerId: true },
    });
    if (!targetUser) return { error: { status: 404, message: 'Target employee not found' } };

    const targetRole = String(targetUser.role || '').toUpperCase();
    const higherRoles = ['SUPER_ADMIN', 'ADMIN', 'CMD', 'HR', 'FINANCE', 'DIRECTOR', 'LEADERSHIP', 'OWNER', 'MANAGER'];
    if (higherRoles.includes(targetRole)) {
      return {
        error: {
          status: 403,
          message: `Access forbidden: managers cannot view tasks of peer or higher authority roles (${targetRole})`,
        },
      };
    }

    const isManager = await goalService.isSubordinate(user.id, targetEmployeeId, tenantId);
    const isSameDept = user.department && targetUser.department === user.department;
    const isCoAssigned = await prisma.goalAssignment.findFirst({
      where: {
        tenantId,
        employeeId: targetEmployeeId,
        goal: {
          OR: [
            { employeeId: user.id },
            { createdById: user.id },
            { assignments: { some: { employeeId: user.id } } },
          ],
        },
      },
    });

    if (!isManager && !isSameDept && !isCoAssigned && targetUser.managerId) {
      return { error: { status: 403, message: 'Access forbidden: user is not in your team' } };
    }
  }

  return {
    where: {
      tenantId,
      employeeId: targetEmployeeId,
      // A private task is only ever visible to its owner.
      ...(targetEmployeeId !== user.id ? { isPrivate: false } : {}),
      ...(fy ? { financialYear: fy } : {}),
    },
  };
}
