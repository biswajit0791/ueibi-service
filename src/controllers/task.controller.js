import { prisma } from '../lib/prisma.js';
import { logTaskAudit } from './taskActivity.controller.js';

// ─── Helper: resolve & authorise target employee ───────────────────────────
async function resolveTargetEmployee(requestingUser, employeeId) {
  if (!employeeId || employeeId === requestingUser.id) {
    return { id: requestingUser.id };
  }

  const targetUser = await prisma.tenantUser.findFirst({
    where: { id: employeeId, tenantId: requestingUser.tenantId },
  });
  if (!targetUser) {
    throw { status: 400, message: 'Invalid employee: user not found in this organisation' };
  }

  const allowedRoles = ['SUPER_ADMIN', 'HR', 'ADMIN'];
  if (!allowedRoles.includes(requestingUser.role)) {
    const subordinate = await prisma.tenantUser.findFirst({
      where: { id: employeeId, managerId: requestingUser.id },
    });
    if (!subordinate) {
      throw { status: 403, message: 'Access forbidden: you are not authorised to assign tasks to this employee' };
    }
  }

  return targetUser;
}

// ─── Helper: assert task exists & requester owns it ────────────────────────
async function assertTaskOwner(id, requestingUser) {
  const task = await prisma.task.findUnique({ where: { id } });
  if (!task) throw { status: 404, message: 'Task not found' };
  if (task.employeeId !== requestingUser.id && requestingUser.role !== 'SUPER_ADMIN' && requestingUser.role !== 'HR') {
    throw { status: 403, message: 'Access forbidden: cannot edit another employee\'s task' };
  }
  return task;
}

// ─── POST /api/tasks ────────────────────────────────────────────────────────
export async function createTask(req, res, next) {
  try {
    const {
      title, priority, startDate, dueDate, financialYear,
      tags, goalId, isPrivate, isStandalone, weight,
      description, employeeId, dependency, isDependencyOf,
    } = req.body || {};

    if (!title) {
      return res.status(400).json({ error: 'Task title is required' });
    }

    const target = await resolveTargetEmployee(req.user, employeeId).catch(e => {
      res.status(e.status || 500).json({ error: e.message });
      return null;
    });
    if (!target) return;

    const task = await prisma.task.create({
      data: {
        title,
        priority,
        startDate: startDate ? new Date(startDate) : undefined,
        dueDate: dueDate ? new Date(dueDate) : undefined,
        financialYear: financialYear || null,
        tags,
        goalId: goalId || undefined,
        isPrivate: isPrivate || false,
        isStandalone: isStandalone || false,
        weight: weight || 1,
        description,
        dependency: dependency || undefined,
        isDependencyOf: isDependencyOf || null,
        employeeId: target.id,
      },
    });

    await logTaskAudit({
      taskId: task.id,
      performedById: req.user.id,
      action: 'created',
      details: `Task "${task.title}" initialized.`,
    });

    res.status(201).json(task);
  } catch (err) {
    next(err);
  }
}

// ─── GET /api/tasks ─────────────────────────────────────────────────────────
export async function listTasks(req, res, next) {
  try {
    const targetEmployeeId = req.query.employeeId || req.user.id;

    // Auth: only self, direct manager, HR, or super-admin may fetch
    if (targetEmployeeId !== req.user.id) {
      const allowedRoles = ['SUPER_ADMIN', 'HR'];
      if (!allowedRoles.includes(req.user.role)) {
        const subordinate = await prisma.tenantUser.findFirst({
          where: { id: targetEmployeeId, managerId: req.user.id },
        });
        if (!subordinate) {
          return res.status(403).json({ error: 'Access forbidden' });
        }
      }
    }

    const where = {
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
    const { status } = req.body || {};

    if (!status) {
      return res.status(400).json({ error: 'Task status is required' });
    }

    await assertTaskOwner(id, req.user).catch(e => {
      res.status(e.status || 500).json({ error: e.message });
      return null;
    });

    const updated = await prisma.task.update({
      where: { id },
      data: { status },
    });

    await logTaskAudit({
      taskId: id,
      performedById: req.user.id,
      action: 'status_changed',
      details: `Status updated to ${status.toUpperCase().replace('_', ' ')}.`,
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
    const {
      title, priority, startDate, dueDate, financialYear,
      tags, goalId, isPrivate, isStandalone, weight,
      description, status, dependency, isDependencyOf,
    } = req.body || {};

    const existing = await assertTaskOwner(id, req.user).catch(e => {
      res.status(e.status || 500).json({ error: e.message });
      return null;
    });
    if (!existing) return;

    const updated = await prisma.task.update({
      where: { id },
      data: {
        ...(title !== undefined && { title }),
        ...(priority !== undefined && { priority }),
        ...(status !== undefined && { status }),
        ...(startDate !== undefined && { startDate: startDate ? new Date(startDate) : null }),
        ...(dueDate !== undefined && { dueDate: dueDate ? new Date(dueDate) : null }),
        ...(financialYear !== undefined && { financialYear }),
        ...(tags !== undefined && { tags }),
        ...(goalId !== undefined && { goalId: goalId || null }),
        ...(isPrivate !== undefined && { isPrivate }),
        ...(isStandalone !== undefined && { isStandalone }),
        ...(weight !== undefined && { weight }),
        ...(description !== undefined && { description }),
        ...(dependency !== undefined && { dependency: dependency || null }),
        ...(isDependencyOf !== undefined && { isDependencyOf: isDependencyOf || null }),
      },
    });

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

    res.json(updated);
  } catch (err) {
    next(err);
  }
}

// ─── DELETE /api/tasks/:id ───────────────────────────────────────────────────
export async function deleteTask(req, res, next) {
  try {
    const { id } = req.params;

    const existing = await assertTaskOwner(id, req.user).catch(e => {
      res.status(e.status || 500).json({ error: e.message });
      return null;
    });
    if (!existing) return;

    // If this task IS a dependency companion — clear the parent's dependency field
    if (existing.isDependencyOf) {
      await prisma.task.updateMany({
        where: { id: existing.isDependencyOf },
        data: { dependency: null, isDependencyOf: null },
      }).catch(() => {}); // best-effort; parent may already be deleted
    }

    // If this task HAS a dependency companion — also delete the companion
    if (existing.dependency?.depTaskId) {
      await prisma.task.deleteMany({
        where: { id: existing.dependency.depTaskId },
      }).catch(() => {});
    }

    await prisma.task.delete({ where: { id } });

    res.json({ success: true });
  } catch (err) {
    next(err);
  }
}
