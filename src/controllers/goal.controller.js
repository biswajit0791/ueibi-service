import { prisma } from '../lib/prisma.js';
import { createGoalSchema, updateGoalSchema, goalReviewSchema } from '../validations/goal.schema.js';
import { goalService, GOAL_CATEGORIES, GOAL_TYPES, GOAL_PRIORITIES } from '../services/goal.service.js';

/**
 * Traverses up the reporting chain from targetId to see if managerId is encountered.
 */
async function checkIsSubordinate(managerId, targetId, tenantId) {
  return goalService.isSubordinate(managerId, targetId, tenantId);
}

export async function getGoalCategories(req, res) {
  res.json({ categories: GOAL_CATEGORIES });
}

export async function getGoalTypes(req, res) {
  res.json({ types: GOAL_TYPES });
}

export async function getGoalPriorities(req, res) {
  res.json({ priorities: GOAL_PRIORITIES });
}

export async function getAssignableUsers(req, res, next) {
  try {
    const role = req.user.role;
    const tenantId = req.tenantId;

    if (role === 'SUPER_ADMIN' || role === 'ADMIN' || role === 'HR' || role === 'LEADERSHIP' || role === 'OWNER') {
      const users = await prisma.tenantUser.findMany({
        where: { tenantId, status: 'ACTIVE' },
        select: {
          id: true,
          name: true,
          email: true,
          role: true,
          department: true,
          designation: true,
          managerId: true,
        },
        orderBy: { name: 'asc' },
      });
      return res.json({ users });
    }

    if (role === 'MANAGER') {
      const allUsers = await prisma.tenantUser.findMany({
        where: { tenantId, status: 'ACTIVE' },
        select: {
          id: true,
          name: true,
          email: true,
          role: true,
          department: true,
          designation: true,
          managerId: true,
        },
      });

      const directReportsMap = {};
      allUsers.forEach(u => {
        if (u.managerId) {
          if (!directReportsMap[u.managerId]) directReportsMap[u.managerId] = [];
          directReportsMap[u.managerId].push(u);
        }
      });

      const downline = [];
      const queue = [req.user.id];
      const visited = new Set();
      while (queue.length > 0) {
        const currentId = queue.shift();
        if (visited.has(currentId)) continue;
        visited.add(currentId);

        const reports = directReportsMap[currentId] || [];
        reports.forEach(r => {
          downline.push(r);
          queue.push(r.id);
        });
      }

      // Allow manager to assign to themselves
      const selfUser = allUsers.find(u => u.id === req.user.id);
      if (selfUser && !downline.some(d => d.id === selfUser.id)) {
        downline.push(selfUser);
      }

      downline.sort((a, b) => a.name.localeCompare(b.name));
      return res.json({ users: downline });
    }

    // For EMPLOYEE, STUDENT, MENTOR, FINANCE: only allow self-assignment
    const selfUser = await prisma.tenantUser.findFirst({
      where: { id: req.user.id, tenantId },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        department: true,
        designation: true,
      },
    });

    return res.json({ users: selfUser ? [selfUser] : [] });
  } catch (err) {
    next(err);
  }
}

export async function createGoal(req, res, next) {
  try {
    const parsed = createGoalSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Validation failed', details: parsed.error.issues });
    }
    const { 
      title, 
      description, 
      category, 
      goalType, 
      priority, 
      financialYear, 
      quarter, 
      startDate, 
      targetDate, 
      attachments, 
      specialNotes, 
      employeeId 
    } = parsed.data;

    if (!title) {
      return res.status(400).json({ error: 'Goal title is required' });
    }

    const targetEmployeeId = employeeId || req.user.id;

    // Verify tenant isolation
    const targetUser = await prisma.tenantUser.findFirst({
      where: { id: targetEmployeeId, tenantId: req.tenantId },
    });
    if (!targetUser) {
      return res.status(400).json({ error: 'Target employee not found in this organization' });
    }

    // Verify assignment authorization
    if (targetEmployeeId !== req.user.id) {
      const allowedRoles = ['SUPER_ADMIN', 'ADMIN', 'HR', 'MANAGER', 'LEADERSHIP', 'OWNER'];
      if (!allowedRoles.includes(req.user.role)) {
        return res.status(403).json({ error: 'Access forbidden: you do not have permission to assign goals to other employees' });
      }

      if (req.user.role === 'MANAGER') {
        const isSubordinate = await checkIsSubordinate(req.user.id, targetEmployeeId, req.tenantId);
        if (!isSubordinate) {
          return res.status(403).json({ error: 'Access forbidden: employee is not in your reporting downline' });
        }
      }
    }

    const goal = await prisma.goal.create({
      data: {
        tenantId: req.tenantId,
        title: title.trim(),
        description: description || null,
        category: category || 'General',
        goalType: goalType || 'General',
        priority: priority || 'medium',
        financialYear: financialYear || 'FY 2026-27',
        quarter: quarter || 'All',
        startDate: startDate ? new Date(startDate) : undefined,
        targetDate: targetDate ? new Date(targetDate) : undefined,
        attachments: attachments || [],
        specialNotes: specialNotes || null,
        employeeId: targetEmployeeId,
        createdBy: req.user.name,
        status: 'DRAFT',
      },
      include: {
        employee: { select: { id: true, name: true, email: true, department: true, designation: true } },
        tasks: true,
      },
    });

    await goalService.logAudit({
      goalId: goal.id,
      performedById: req.user.id,
      action: 'GOAL_CREATED',
      details: `${req.user.name} created goal "${goal.title}"${targetEmployeeId !== req.user.id ? ` assigned to ${targetUser.name}` : ''}.`,
    });

    res.status(201).json(goal);
  } catch (err) {
    next(err);
  }
}

export async function listGoals(req, res, next) {
  try {
    const { employeeId, status, financialYear, category } = req.query;

    const where = { tenantId: req.tenantId };

    if (employeeId && employeeId !== 'all') {
      // Verify target employee belongs to tenant
      const targetUser = await prisma.tenantUser.findFirst({
        where: { id: employeeId, tenantId: req.tenantId },
      });
      if (!targetUser) {
        return res.status(400).json({ error: 'Target employee not found in this organization' });
      }

      // Verify authorization
      if (employeeId !== req.user.id && !['SUPER_ADMIN', 'ADMIN', 'HR', 'LEADERSHIP', 'OWNER'].includes(req.user.role)) {
        const isSubordinate = await checkIsSubordinate(req.user.id, employeeId, req.tenantId);
        if (!isSubordinate) {
          return res.status(403).json({ error: 'Access forbidden: user is not your subordinate' });
        }
      }
      where.employeeId = employeeId;
    } else if (!employeeId) {
      // By default if regular employee -> own goals; if manager/HR -> own + subordinates or all
      if (['SUPER_ADMIN', 'ADMIN', 'HR', 'LEADERSHIP', 'OWNER'].includes(req.user.role)) {
        // Can view all in tenant if wanted, but default to caller's goals
        where.employeeId = req.user.id;
      } else {
        where.employeeId = req.user.id;
      }
    }

    if (status && status !== 'all') {
      where.status = status;
    }
    if (financialYear && financialYear !== 'all') {
      where.financialYear = financialYear;
    }
    if (category && category !== 'all') {
      where.category = category;
    }

    const items = await prisma.goal.findMany({
      where,
      include: {
        employee: {
          select: { id: true, name: true, email: true, department: true, designation: true, managerId: true },
        },
        tasks: {
          orderBy: { createdAt: 'asc' },
          include: {
            employee: { select: { id: true, name: true } },
          },
        },
        auditLogs: {
          orderBy: { createdAt: 'desc' },
          include: {
            performedBy: { select: { id: true, name: true, role: true } },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    res.json({ items });
  } catch (err) {
    next(err);
  }
}

export async function getGoalById(req, res, next) {
  try {
    const { id } = req.params;

    const goal = await prisma.goal.findFirst({
      where: { id, tenantId: req.tenantId },
      include: {
        employee: {
          select: { id: true, name: true, email: true, department: true, designation: true, managerId: true },
        },
        tasks: {
          orderBy: { createdAt: 'asc' },
          include: {
            employee: { select: { id: true, name: true } },
          },
        },
        auditLogs: {
          orderBy: { createdAt: 'desc' },
          include: {
            performedBy: { select: { id: true, name: true, role: true } },
          },
        },
      },
    });

    if (!goal) {
      return res.status(404).json({ error: 'Goal not found' });
    }

    res.json(goal);
  } catch (err) {
    next(err);
  }
}

export async function updateGoal(req, res, next) {
  try {
    const { id } = req.params;
    const parsed = updateGoalSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Validation failed', details: parsed.error.issues });
    }

    const existing = await prisma.goal.findFirst({
      where: { id, tenantId: req.tenantId },
    });

    if (!existing) {
      return res.status(404).json({ error: 'Goal not found' });
    }

    const isOwner = existing.employeeId === req.user.id;
    const isElevated = ['SUPER_ADMIN', 'ADMIN', 'HR'].includes(req.user.role);
    if (!isOwner && !isElevated) {
      const isSubordinate = await checkIsSubordinate(req.user.id, existing.employeeId, req.tenantId);
      if (!isSubordinate) {
        return res.status(403).json({ error: 'Access forbidden: you cannot edit this goal' });
      }
    }

    const updated = await prisma.goal.update({
      where: { id },
      data: {
        ...(parsed.data.title ? { title: parsed.data.title.trim() } : {}),
        ...(parsed.data.description !== undefined ? { description: parsed.data.description } : {}),
        ...(parsed.data.category ? { category: parsed.data.category } : {}),
        ...(parsed.data.goalType ? { goalType: parsed.data.goalType } : {}),
        ...(parsed.data.priority ? { priority: parsed.data.priority } : {}),
        ...(parsed.data.financialYear ? { financialYear: parsed.data.financialYear } : {}),
        ...(parsed.data.quarter ? { quarter: parsed.data.quarter } : {}),
        ...(parsed.data.startDate ? { startDate: new Date(parsed.data.startDate) } : {}),
        ...(parsed.data.targetDate ? { targetDate: new Date(parsed.data.targetDate) } : {}),
        ...(parsed.data.attachments ? { attachments: parsed.data.attachments } : {}),
        ...(parsed.data.specialNotes !== undefined ? { specialNotes: parsed.data.specialNotes } : {}),
        ...(parsed.data.status ? { status: parsed.data.status } : {}),
      },
      include: {
        employee: true,
        tasks: true,
        auditLogs: { orderBy: { createdAt: 'desc' }, include: { performedBy: { select: { id: true, name: true, role: true } } } },
      },
    });

    await goalService.logAudit({
      goalId: id,
      performedById: req.user.id,
      action: 'GOAL_UPDATED',
      details: `${req.user.name} updated goal details.`,
    });

    res.json(updated);
  } catch (err) {
    next(err);
  }
}

export async function deleteGoal(req, res, next) {
  try {
    const { id } = req.params;

    const goal = await prisma.goal.findFirst({
      where: { id, tenantId: req.tenantId },
    });

    if (!goal) {
      return res.status(404).json({ error: 'Goal not found' });
    }

    // Verify authorization
    if (goal.employeeId !== req.user.id && req.user.role !== 'SUPER_ADMIN' && req.user.role !== 'HR') {
      const isSubordinate = await checkIsSubordinate(req.user.id, goal.employeeId, req.tenantId);
      if (!isSubordinate) {
        return res.status(403).json({ error: 'Access forbidden' });
      }
    }

    await prisma.goal.delete({
      where: { id },
    });

    res.json({ success: true });
  } catch (err) {
    next(err);
  }
}

// ── Workflow Action Handlers ───────────────────────────────────────────────

export async function submitGoal(req, res, next) {
  try {
    const { id } = req.params;
    const result = await goalService.submitGoal({
      tenantId: req.tenantId,
      goalId: id,
      user: req.user,
    });
    res.json(result);
  } catch (err) {
    if (err.status) {
      return res.status(err.status).json({ error: err.message });
    }
    next(err);
  }
}

export async function managerApproveGoal(req, res, next) {
  try {
    const { id } = req.params;
    const { comment, rating } = req.body || {};
    const result = await goalService.managerReview({
      tenantId: req.tenantId,
      goalId: id,
      user: req.user,
      action: 'APPROVE',
      comment,
      rating,
    });
    res.json(result);
  } catch (err) {
    if (err.status) {
      return res.status(err.status).json({ error: err.message });
    }
    next(err);
  }
}

export async function managerRejectGoal(req, res, next) {
  try {
    const { id } = req.params;
    const validated = goalReviewSchema.safeParse({ action: 'REJECT', comment: req.body?.comment });
    if (!validated.success) {
      return res.status(400).json({ error: validated.error.errors[0]?.message || 'Rejection reason is required' });
    }
    const result = await goalService.managerReview({
      tenantId: req.tenantId,
      goalId: id,
      user: req.user,
      action: 'REJECT',
      comment: validated.data.comment,
    });
    res.json(result);
  } catch (err) {
    if (err.status) {
      return res.status(err.status).json({ error: err.message });
    }
    next(err);
  }
}

export async function hrApproveGoal(req, res, next) {
  try {
    const { id } = req.params;
    const { comment, rating } = req.body || {};
    const result = await goalService.hrReview({
      tenantId: req.tenantId,
      goalId: id,
      user: req.user,
      action: 'APPROVE',
      comment,
      rating,
    });
    res.json(result);
  } catch (err) {
    if (err.status) {
      return res.status(err.status).json({ error: err.message });
    }
    next(err);
  }
}

export async function hrRejectGoal(req, res, next) {
  try {
    const { id } = req.params;
    const validated = goalReviewSchema.safeParse({ action: 'REJECT', comment: req.body?.comment });
    if (!validated.success) {
      return res.status(400).json({ error: validated.error.errors[0]?.message || 'Rejection reason is required' });
    }
    const result = await goalService.hrReview({
      tenantId: req.tenantId,
      goalId: id,
      user: req.user,
      action: 'REJECT',
      comment: validated.data.comment,
    });
    res.json(result);
  } catch (err) {
    if (err.status) {
      return res.status(err.status).json({ error: err.message });
    }
    next(err);
  }
}

export async function resubmitGoal(req, res, next) {
  try {
    const { id } = req.params;
    const { comment } = req.body || {};
    const result = await goalService.resubmitGoal({
      tenantId: req.tenantId,
      goalId: id,
      user: req.user,
      comment,
    });
    res.json(result);
  } catch (err) {
    if (err.status) {
      return res.status(err.status).json({ error: err.message });
    }
    next(err);
  }
}
