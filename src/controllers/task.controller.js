import { prisma } from '../lib/prisma.js';
import { logTaskAudit } from './taskActivity.controller.js';
import { emitToTenant } from '../lib/socket.js';
import { createTaskSchema, updateTaskSchema, updateTaskStatusSchema } from '../validations/task.schema.js';
import { goalService } from '../services/goal.service.js';
import { loadTaskForUser, getCompanionTaskId } from '../services/taskAccess.service.js';
import { ELEVATED_ROLES, hasRole } from '../lib/roles.js';
import { TASK_STATUSES } from '../lib/workflowStatus.js';

// ─── Helper: resolve & authorise target employee ───────────────────────────
// Returns the TenantUser record that will own the task.
// Verifies the employee belongs to the SAME tenant as the requesting user.
async function resolveTargetEmployee(requestingUser, tenantId, employeeId, parentTask = null, goalId = null) {
  // If no employeeId supplied → default to the requesting user themselves
  if (!employeeId) {
    return { id: requestingUser.id };
  }

  // If assigning to self → fast path (no extra DB check needed)
  if (employeeId === requestingUser.id) {
    return { id: requestingUser.id };
  }

  // Verify the target employee exists AND belongs to the authenticated tenant
  const targetUser = await prisma.tenantUser.findFirst({
    where: { id: employeeId, tenantId, isDeleted: false },
  });

  if (!targetUser) {
    throw { status: 403, message: 'Access forbidden: target employee not found in your organisation' };
  }

  // Tier 4: Elevated roles can assign across the org freely
  if (hasRole(requestingUser.role, ELEVATED_ROLES)) {
    return targetUser;
  }

  // Peer dependency: you may spin off a companion task on a colleague ONLY when
  // it hangs off a real parent task that YOU own (or manage).
  if (parentTask) {
    const ownsParent = parentTask.employeeId === requestingUser.id
      || await goalService.isSubordinate(requestingUser.id, parentTask.employeeId, tenantId);
    if (ownsParent) {
      return targetUser;
    }
    throw { status: 403, message: 'Access forbidden: you can only raise a dependency from a task you own' };
  }

  const callerRole = String(requestingUser.role || '').toUpperCase();
  const targetRole = String(targetUser.role || '').toUpperCase();
  const elevatedRoleList = ['SUPER_ADMIN', 'ADMIN', 'HR', 'CMD', 'DIRECTOR', 'OWNER', 'LEADERSHIP'];

  // Regular EMPLOYEE: Cannot assign main tasks to other people (especially higher roles)
  if (callerRole === 'EMPLOYEE' || !['MANAGER', ...elevatedRoleList].includes(callerRole)) {
    throw {
      status: 403,
      message: 'Access forbidden: employees can only assign tasks to themselves. To request support from a colleague, use the dependency option.',
    };
  }

  // MANAGER:
  if (callerRole === 'MANAGER') {
    // Cannot assign tasks to peer managers or higher authority roles (HR, Admin, etc.)
    if (elevatedRoleList.includes(targetRole) || targetRole === 'MANAGER') {
      throw {
        status: 403,
        message: `Access forbidden: managers cannot assign tasks to peer or higher authority roles (${targetRole})`,
      };
    }

    // 1. Direct or indirect downline subordinate:
    if (await goalService.isSubordinate(requestingUser.id, employeeId, tenantId)) {
      return targetUser;
    }

    // 2. Co-assigned on the goal:
    if (goalId) {
      const coAssigned = await prisma.goalAssignment.findFirst({
        where: { goalId, employeeId, tenantId },
      });
      if (coAssigned) {
        return targetUser;
      }
    }

    // 3. Same department or target employee has no explicit manager set:
    if (requestingUser.department && targetUser.department === requestingUser.department) {
      return targetUser;
    }
    if (!targetUser.managerId) {
      return targetUser;
    }
  }

  throw { status: 403, message: 'Access forbidden: you are not authorised to assign tasks to this employee' };
}

// ─── Helper: assert task exists & requester owns/manages it ────────────────
// Thin wrapper around the shared taskAccess service so task.controller and
// taskActivity.controller enforce exactly the same rule.
const assertTaskOwner = (id, requestingUser, tenantId) => loadTaskForUser(id, requestingUser, tenantId);

// ─── Helper: validate goal belongs to same tenant ─────────────────────────
async function resolveGoal(goalId, tenantId) {
  if (!goalId) return null;

  const goal = await prisma.goal.findFirst({ where: { id: goalId } });
  if (!goal) throw { status: 404, message: `Goal not found: ${goalId}` };
  if (goal.tenantId !== tenantId) {
    throw { status: 403, message: 'Access forbidden: goal belongs to a different organisation' };
  }
  return goal;
}

async function recalculateGoalProgress(goalId, employeeId = null) {
  if (!goalId) return 0;
  return await goalService.recalculateProgress(goalId, employeeId);
}

// ─── POST /api/tasks ────────────────────────────────────────────────────────
export async function createTask(req, res, next) {
  try {
    // 1. Guard: tenant context must be present (set by auth middleware from JWT)
    const tenantId = req.tenantId;
    if (!tenantId) {
      return res.status(401).json({ success: false, message: 'Tenant context is required to create a task' });
    }

    const parsed = createTaskSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ success: false, error: 'Validation failed', details: parsed.error.issues });
    }
    const {
      title, priority, startDate, dueDate, financialYear,
      tags, goalId, isPrivate, isStandalone, weight,
      description, employeeId, dependency, isDependencyOf,
      status, progress,
    } = parsed.data;

    // 3. Date validation: dueDate must not be earlier than startDate
    if (startDate && dueDate) {
      const start = new Date(startDate);
      const due = new Date(dueDate);
      if (isNaN(start.getTime()) || isNaN(due.getTime())) {
        return res.status(400).json({ success: false, message: 'Invalid date format for startDate or dueDate' });
      }
      if (due < start) {
        return res.status(400).json({
          success: false,
          message: 'Due date cannot be earlier than start date',
        });
      }
    }

    // 4a. If this task is a companion of a parent ("dependency") task, that parent
    //     must be a real task in this tenant that the caller is allowed to act on.
    let parentTask = null;
    if (isDependencyOf) {
      try {
        parentTask = await loadTaskForUser(isDependencyOf, req.user, tenantId);
      } catch (e) {
        return res.status(e.status || 500).json({ success: false, message: e.message || 'Invalid parent task' });
      }
    }

    // 4b. Resolve and authorise the target employee (cross-tenant guard inside)
    let target;
    try {
      target = await resolveTargetEmployee(req.user, tenantId, employeeId, parentTask, goalId);
    } catch (e) {
      return res.status(e.status || 500).json({ success: false, message: e.message });
    }

    // 5. Validate goal tenant scope (if goalId provided). A plain employee adding
    //    a task *for themselves* may only attach it to a goal they participate in
    //    — otherwise they could skew an unrelated goal's progress rollup.
    let resolvedGoalId = null;
    if (!isStandalone && goalId) {
      try {
        const goal = await resolveGoal(goalId, tenantId);
        if (goal && target.id === req.user.id && !hasRole(req.user.role, ELEVATED_ROLES)) {
          const onGoal = goal.employeeId === req.user.id
            || goal.createdById === req.user.id
            || (await prisma.goalAssignment.findFirst({
                where: { goalId: goal.id, employeeId: req.user.id }, select: { id: true },
              })) !== null;
          if (!onGoal) {
            return res.status(403).json({ success: false, message: 'You are not assigned to this goal' });
          }
        }
        resolvedGoalId = goal?.id || null;
      } catch (e) {
        return res.status(e.status || 500).json({ success: false, message: e.message });
      }
    }

    // 6. Create task — always connect to the authenticated tenant
    const task = await prisma.task.create({
      data: {
        title: title.trim(),
        priority: priority || 'medium',
        status: status || 'todo',
        progress: progress || 0,
        startDate: startDate ? new Date(startDate) : undefined,
        dueDate: dueDate ? new Date(dueDate) : undefined,
        financialYear: financialYear || null,
        tags: tags || null,
        isPrivate: isPrivate ?? false,
        isStandalone: isStandalone ?? false,
        weight: weight || 1,
        description: description || null,
        dependency: dependency || null,
        isDependencyOf: isDependencyOf || null,
        // ─ Relations ─
        employee: { connect: { id: target.id } },
        tenant: { connect: { id: tenantId } },
        ...(resolvedGoalId ? { goal: { connect: { id: resolvedGoalId } } } : {}),
      },
    });

    let goalProgress = 0;
    if (resolvedGoalId) {
      goalProgress = await recalculateGoalProgress(resolvedGoalId, task.employeeId);
    }

    // 7. Audit log
    await logTaskAudit({
      taskId: task.id,
      performedById: req.user.id,
      action: 'created',
      details: `Task "${task.title}" created.`,
    });

    emitToTenant(tenantId, 'task_updated', {
      action: 'create',
      task: {
        ...task,
        progress: task.progress || 0,
        weight: task.weight || 1,
      },
      goalId: resolvedGoalId,
      goalProgress,
    });

    res.status(201).json(task);
  } catch (err) {
    next(err);
  }
}

// ─── GET /api/tasks ─────────────────────────────────────────────────────────
export async function listTasks(req, res, next) {
  try {
    const tenantId = req.tenantId;
    const targetEmployeeId = req.query.employeeId || req.user.id;
    const callerRole = String(req.user.role || '').toUpperCase();
    const isElevated = hasRole(req.user.role, ELEVATED_ROLES);

    // Regular employee can only ever view their own tasks
    if (callerRole === 'EMPLOYEE' && !isElevated) {
      if (targetEmployeeId !== 'all' && targetEmployeeId !== req.user.id) {
        return res.status(403).json({ error: 'Access forbidden: employees can only view their own tasks' });
      }
      const where = {
        tenantId,
        employeeId: req.user.id,
        ...(req.query.fy ? { financialYear: req.query.fy } : {}),
      };
      const items = await prisma.task.findMany({
        where,
        orderBy: { createdAt: 'desc' },
      });
      return res.json({ items });
    }

    if (targetEmployeeId === 'all') {
      let whereClause = { tenantId };
      if (!isElevated) {
        // Manager: own tasks, tasks of downline subordinates, same-dept employees with role EMPLOYEE,
        // and companion dependency tasks that hang off one of those tasks.
        const downline = await prisma.tenantUser.findMany({
          where: { tenantId, isDeleted: false },
          select: { id: true, managerId: true, department: true, role: true },
        });
        const childrenOf = {};
        downline.forEach((u) => {
          if (u.managerId) (childrenOf[u.managerId] ||= []).push(u.id);
        });
        const allowedIds = new Set([req.user.id]);
        const queue = [req.user.id];
        while (queue.length) {
          const cur = queue.shift();
          for (const child of childrenOf[cur] || []) {
            if (!allowedIds.has(child)) { allowedIds.add(child); queue.push(child); }
          }
        }

        // Also add same-department employees with role EMPLOYEE / STUDENT
        if (req.user.department) {
          downline.forEach(u => {
            if (u.department === req.user.department && ['EMPLOYEE', 'STUDENT'].includes(String(u.role || '').toUpperCase())) {
              allowedIds.add(u.id);
            }
          });
        }

        const allowedIdList = [...allowedIds];
        // Companion ("dependency") tasks are visible when their parent task is
        // owned by someone in the downline — NOT tenant-wide as before.
        const visibleParents = await prisma.task.findMany({
          where: { tenantId, employeeId: { in: allowedIdList } },
          select: { id: true },
        });
        whereClause.OR = [
          { employeeId: { in: allowedIdList } },
          { isDependencyOf: { in: visibleParents.map((t) => t.id) } },
        ];
      }
      const items = await prisma.task.findMany({
        where: whereClause,
        orderBy: { createdAt: 'desc' },
      });
      return res.json({ items });
    }

    // Auth: only self, a manager anywhere up the chain, HR, Admin, or super-admin may fetch
    if (targetEmployeeId !== req.user.id) {
      if (!isElevated) {
        const targetUser = await prisma.tenantUser.findFirst({
          where: { id: targetEmployeeId, tenantId, isDeleted: false },
          select: { id: true, role: true, department: true, managerId: true },
        });
        if (!targetUser) {
          return res.status(404).json({ error: 'Target employee not found' });
        }

        const targetRole = String(targetUser.role || '').toUpperCase();
        const higherRoles = ['SUPER_ADMIN', 'ADMIN', 'CMD', 'HR', 'FINANCE', 'DIRECTOR', 'LEADERSHIP', 'OWNER', 'MANAGER'];
        if (higherRoles.includes(targetRole)) {
          return res.status(403).json({
            error: `Access forbidden: managers cannot view tasks of peer or higher authority roles (${targetRole})`,
          });
        }

        const isManager = await goalService.isSubordinate(req.user.id, targetEmployeeId, tenantId);
        const isSameDept = req.user.department && targetUser.department === req.user.department;
        const isCoAssigned = await prisma.goalAssignment.findFirst({
          where: {
            tenantId,
            employeeId: targetEmployeeId,
            goal: {
              OR: [
                { employeeId: req.user.id },
                { createdById: req.user.id },
                { assignments: { some: { employeeId: req.user.id } } },
              ],
            },
          },
        });

        if (!isManager && !isSameDept && !isCoAssigned && targetUser.managerId) {
          return res.status(403).json({ error: 'Access forbidden: user is not in your team' });
        }
      }
    }

    const where = {
      tenantId,
      employeeId: targetEmployeeId,
      // Private tasks only visible to the owner
      ...(targetEmployeeId !== req.user.id ? { isPrivate: false } : {}),
    };

    const fy = req.query.fy;
    if (fy) where.financialYear = fy;

    const items = await prisma.task.findMany({
      where,
      orderBy: { createdAt: 'desc' },
    });

    res.json({ items });
  } catch (err) {
    next(err);
  }
}

// ─── PATCH /api/tasks/:id/status ────────────────────────────────────────────
export async function updateTaskStatus(req, res, next) {
  try {
    const { id } = req.params;
    const parsed = updateTaskStatusSchema.safeParse(req.body || {});
    if (!parsed.success) {
      return res.status(400).json({ error: 'Validation failed', details: parsed.error.issues });
    }
    const { status, progress } = parsed.data;
    const tenantId = req.tenantId;

    const existing = await assertTaskOwner(id, req.user, tenantId).catch(e => {
      res.status(e.status || 500).json({ error: e.message });
      return null;
    });
    if (!existing) return;

    let progressUpdate = progress !== undefined ? Number(progress) : undefined;
    if (progressUpdate === undefined) {
      if (status === 'done') progressUpdate = 100;
      else if (status === 'todo') progressUpdate = 0;
      else if (status === 'in_progress' && (!existing.progress || existing.progress === 0)) progressUpdate = 10;
    } else {
      progressUpdate = Math.min(100, Math.max(0, progressUpdate));
    }

    const updated = await prisma.task.update({
      where: { id },
      data: { 
        status,
        ...(progressUpdate !== undefined && !isNaN(progressUpdate) && { progress: progressUpdate })
      },
    });

    let goalProgress = 0;
    if (updated.goalId) {
      goalProgress = await recalculateGoalProgress(updated.goalId, updated.employeeId);
    }

    if (updated.status === 'done' && updated.isDependencyOf) {
      const parentTask = await prisma.task.findUnique({
        where: { id: updated.isDependencyOf }
      });
      if (parentTask) {
        const updatedDependency = parentTask.dependency ? {
          ...parentTask.dependency,
          status: 'completed'
        } : null;
        
        const updatedParent = await prisma.task.update({
          where: { id: parentTask.id },
          data: {
            status: parentTask.status === 'pending_on_others' ? 'in_progress' : parentTask.status,
            dependency: updatedDependency
          }
        });
        
        let parentGoalProgress = 0;
        if (updatedParent.goalId) {
          parentGoalProgress = await recalculateGoalProgress(updatedParent.goalId, updatedParent.employeeId);
        }
        
        emitToTenant(tenantId, 'task_updated', {
          action: 'update',
          task: updatedParent,
          goalId: updatedParent.goalId,
          goalProgress: parentGoalProgress,
        });
      }
    }

    await logTaskAudit({
      taskId: id,
      performedById: req.user.id,
      action: 'status_changed',
      details: `Status updated to ${status.toUpperCase().replace('_', ' ')}.`,
    });

    emitToTenant(tenantId, 'task_updated', {
      action: 'update',
      task: updated,
      goalId: updated.goalId,
      goalProgress,
    });

    res.json(updated);
  } catch (err) {
    next(err);
  }
}

// ─── PUT /api/tasks/:id ─────────────────────────────────────────────────────
export async function updateTask(req, res, next) {
  try {
    const { id } = req.params;
    const tenantId = req.tenantId;
    const parsed = updateTaskSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ success: false, error: 'Validation failed', details: parsed.error.issues });
    }
    const {
      title, priority, startDate, dueDate, financialYear,
      tags, goalId, isPrivate, isStandalone, weight,
      description, status, progress, dependency, isDependencyOf, employeeId,
    } = parsed.data;

    // Date validation on update too
    if (startDate && dueDate) {
      const start = new Date(startDate);
      const due = new Date(dueDate);
      if (!isNaN(start.getTime()) && !isNaN(due.getTime()) && due < start) {
        return res.status(400).json({
          success: false,
          message: 'Due date cannot be earlier than start date',
        });
      }
    }

    const existing = await assertTaskOwner(id, req.user, tenantId).catch(e => {
      res.status(e.status || 500).json({ error: e.message });
      return null;
    });
    if (!existing) return;

    const isElevated = hasRole(req.user.role, ELEVATED_ROLES);
    // "Manager" here means anywhere up the reporting chain of the task owner.
    const isDirectManager = !isElevated && existing.employeeId && existing.employeeId !== req.user.id
      ? await goalService.isSubordinate(req.user.id, existing.employeeId, tenantId)
      : false;

    // ── Field-level authorization checks ─────────────────────────────────
    // 1. Reassignment guard: employees cannot reassign tasks
    if (employeeId !== undefined && employeeId !== existing.employeeId) {
      if (!isElevated && !isDirectManager) {
        return res.status(403).json({ success: false, error: 'Forbidden: Employees cannot reassign tasks' });
      }
      try {
        let existingParent = null;
        if (existing.isDependencyOf) {
          existingParent = await prisma.task.findFirst({ where: { id: existing.isDependencyOf, tenantId } });
        }
        await resolveTargetEmployee(req.user, tenantId, employeeId, existingParent, existing.goalId);
      } catch (e) {
        return res.status(e.status || 500).json({ success: false, message: e.message });
      }
    }

    // 2. Goal assignment guard: employees cannot move task between goals
    if (goalId !== undefined && goalId !== existing.goalId) {
      if (!isElevated && !isDirectManager) {
        return res.status(403).json({ success: false, error: 'Forbidden: Employees cannot reassign task goal' });
      }
    }

    // 3. Weight guard: employees cannot alter task weight
    if (weight !== undefined && weight !== existing.weight) {
      if (!isElevated && !isDirectManager) {
        return res.status(403).json({ success: false, error: 'Forbidden: Employees cannot modify task weight' });
      }
    }

    // 4. Dependency parent mapping guard
    if (isDependencyOf !== undefined && isDependencyOf !== existing.isDependencyOf) {
      if (!isElevated && !isDirectManager && existing.employeeId !== req.user.id) {
        return res.status(403).json({ success: false, error: 'Forbidden: Employees cannot modify dependency structure' });
      }
    }

    // 5. Dependency approval guard: employees cannot approve dependencies directly
    if (dependency !== undefined && dependency !== null) {
      if (dependency.status === 'approved' && existing.dependency?.status !== 'approved' && !isElevated && !isDirectManager) {
        return res.status(403).json({ success: false, error: 'Forbidden: Employees cannot approve dependencies' });
      }
    }

    // If goalId is being updated, validate tenant scope
    let resolvedGoalId = undefined;
    if (goalId !== undefined) {
      if (!goalId) {
        resolvedGoalId = null;
      } else {
        try {
          const goal = await resolveGoal(goalId, tenantId);
          resolvedGoalId = goal?.id || null;
        } catch (e) {
          return res.status(e.status || 500).json({ success: false, message: e.message });
        }
      }
    }

    let finalProgress = progress;
    let finalStatus = status;
    
    if (finalProgress === undefined && status !== undefined) {
      if (status === 'done') finalProgress = 100;
      else if (status === 'todo') finalProgress = 0;
    }
    if (progress !== undefined && finalStatus === undefined) {
      if (progress === 100) finalStatus = 'done';
      else if (progress > 0) finalStatus = 'in_progress';
      else if (progress === 0) finalStatus = 'todo';
    }

    const updated = await prisma.task.update({
      where: { id },
      data: {
        ...(title !== undefined && { title: title.trim() }),
        ...(priority !== undefined && { priority }),
        ...(finalStatus !== undefined && { status: finalStatus }),
        ...(finalProgress !== undefined && { progress: finalProgress }),
        ...(startDate !== undefined && { startDate: startDate ? new Date(startDate) : null }),
        ...(dueDate !== undefined && { dueDate: dueDate ? new Date(dueDate) : null }),
        ...(financialYear !== undefined && { financialYear }),
        ...(tags !== undefined && { tags }),
        ...(resolvedGoalId !== undefined && { goalId: resolvedGoalId }),
        ...(isPrivate !== undefined && (isElevated || isDirectManager || existing.employeeId === req.user.id) && { isPrivate }),
        ...(isStandalone !== undefined && (isElevated || isDirectManager) && { isStandalone }),
        ...(weight !== undefined && (isElevated || isDirectManager) && { weight }),
        ...(description !== undefined && { description }),
        ...(dependency !== undefined && (isElevated || isDirectManager || existing.employeeId === req.user.id) && { dependency: dependency || null }),
        ...(isDependencyOf !== undefined && (isElevated || isDirectManager || existing.employeeId === req.user.id) && { isDependencyOf: isDependencyOf || null }),
        ...(employeeId !== undefined && (isElevated || isDirectManager) && { employeeId }),
      },
    });

    let goalProgress = 0;
    if (updated.goalId) {
      goalProgress = await recalculateGoalProgress(updated.goalId, updated.employeeId);
    }

    // If dependency was updated and has a companion task - keep it synchronized
    if (dependency !== undefined && dependency !== null) {
      const companionTaskId = getCompanionTaskId(dependency);
      if (companionTaskId) {
        const companionTask = await prisma.task.findFirst({
          where: { id: companionTaskId, tenantId }
        });
        if (companionTask) {
          const updatedCompanion = await prisma.task.update({
            where: { id: companionTaskId },
            data: {
              employeeId: dependency.concernedPersonId,
              title: dependency.title,
              description: dependency.description || null,
              dueDate: dependency.dueDate ? new Date(dependency.dueDate) : null,
            }
          });
          
          emitToTenant(tenantId, 'task_updated', {
            action: 'update',
            task: updatedCompanion,
            goalId: updatedCompanion.goalId,
            goalProgress: 0,
          });
        }
      }
    }

    if (updated.status === 'done' && updated.isDependencyOf) {
      const parentTask = await prisma.task.findUnique({
        where: { id: updated.isDependencyOf }
      });
      if (parentTask) {
        const updatedDependency = parentTask.dependency ? {
          ...parentTask.dependency,
          status: 'completed'
        } : null;
        
        const updatedParent = await prisma.task.update({
          where: { id: parentTask.id },
          data: {
            status: parentTask.status === 'pending_on_others' ? 'in_progress' : parentTask.status,
            dependency: updatedDependency
          }
        });
        
        let parentGoalProgress = 0;
        if (updatedParent.goalId) {
          parentGoalProgress = await recalculateGoalProgress(updatedParent.goalId, updatedParent.employeeId);
        }
        
        emitToTenant(tenantId, 'task_updated', {
          action: 'update',
          task: updatedParent,
          goalId: updatedParent.goalId,
          goalProgress: parentGoalProgress,
        });
      }
    }

    // Determine details of edit
    let details = 'Task edited.';
    let action = 'edited';
    if (dependency !== undefined && dependency !== null && existing.dependency === null) {
      action = 'dependency_created';
      details = `Created dependency: "${dependency.title || 'Untitled'}".`;
    } else if (status !== undefined && status !== existing.status) {
      action = 'status_changed';
      details = `Status updated to ${status.toUpperCase().replace('_', ' ')}.`;
    }

    await logTaskAudit({
      taskId: id,
      performedById: req.user.id,
      action,
      details,
    });

    emitToTenant(tenantId, 'task_updated', {
      action: 'update',
      task: updated,
      goalId: updated.goalId,
      goalProgress,
    });

    res.json(updated);
  } catch (err) {
    next(err);
  }
}

// ─── DELETE /api/tasks/:id ───────────────────────────────────────────────────
export async function deleteTask(req, res, next) {
  try {
    const { id } = req.params;
    const tenantId = req.tenantId;

    const existing = await assertTaskOwner(id, req.user, tenantId).catch(e => {
      res.status(e.status || 500).json({ error: e.message });
      return null;
    });
    if (!existing) return;

    // If this task IS a dependency companion — clear the parent's dependency field
    if (existing.isDependencyOf) {
      await prisma.task.updateMany({
        where: { id: existing.isDependencyOf, tenantId },
        data: { dependency: null, isDependencyOf: null },
      }).catch(() => {}); // best-effort; parent may already be deleted
    }

    // If this task HAS a dependency companion — also delete the companion
    const companionId = getCompanionTaskId(existing.dependency);
    if (companionId) {
      await prisma.task.deleteMany({
        where: { id: companionId, tenantId },
      }).catch(() => {});
    }

    await prisma.task.delete({ where: { id } });

    let goalProgress = 0;
    if (existing.goalId) {
      goalProgress = await recalculateGoalProgress(existing.goalId, existing.employeeId);
    }

    emitToTenant(tenantId, 'task_updated', {
      action: 'delete',
      taskId: id,
      goalId: existing.goalId,
      goalProgress,
    });

    res.json({ success: true });
  } catch (err) {
    next(err);
  }
}
