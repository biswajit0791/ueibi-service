import { prisma } from '../lib/prisma.js';
import {
  createGoalSchema,
  updateGoalSchema,
  goalReviewSchema,
  goalSubmitSchema,
  goalApproveSchema,
  goalRejectSchema,
  goalResubmitSchema,
} from '../validations/goal.schema.js';
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

    const hasSubordinates = directReportsMap[req.user.id] && directReportsMap[req.user.id].length > 0;

    if (role === 'MANAGER' || hasSubordinates) {
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

      // Allow manager to assign to themselves as well (self-assignment)
      const selfUser = allUsers.find(u => u.id === req.user.id);
      if (selfUser && !downline.some(d => d.id === selfUser.id)) {
        downline.push(selfUser);
      }

      downline.sort((a, b) => a.name.localeCompare(b.name));
      return res.json({ users: downline });
    }

    // For standard EMPLOYEE with no reports: only allow self-assignment
    const selfUser = allUsers.find(u => u.id === req.user.id);
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
      dueDate,
      attachments, 
      specialNotes, 
      employeeId,
      employeeIds: rawEmployeeIds,
    } = parsed.data;

    if (!title || !title.trim()) {
      return res.status(400).json({ error: 'Goal title is required' });
    }

    let targetEmployeeIds = [];
    if (Array.isArray(rawEmployeeIds) && rawEmployeeIds.length > 0) {
      targetEmployeeIds = rawEmployeeIds;
    } else if (employeeId) {
      targetEmployeeIds = [employeeId];
    } else {
      targetEmployeeIds = [req.user.id];
    }

    // Normalize and deduplicate IDs
    targetEmployeeIds = [...new Set(targetEmployeeIds.filter(Boolean))];

    if (targetEmployeeIds.length === 0) {
      return res.status(400).json({ error: 'Please select at least one employee for goal assignment' });
    }

    // Verify all target employees exist in tenant and are active
    const targetUsers = await prisma.tenantUser.findMany({
      where: {
        id: { in: targetEmployeeIds },
        tenantId: req.tenantId,
        status: 'ACTIVE',
      },
      select: { id: true, name: true, email: true, department: true, designation: true, managerId: true },
    });

    if (targetUsers.length !== targetEmployeeIds.length) {
      const foundIds = new Set(targetUsers.map(u => u.id));
      const missingIds = targetEmployeeIds.filter(id => !foundIds.has(id));
      return res.status(400).json({
        error: `One or more selected employees not found in organization: ${missingIds.join(', ')}`,
      });
    }

    // Enforce server-side RBAC & Manager reporting downline authorization
    const allowedRoles = ['SUPER_ADMIN', 'ADMIN', 'HR', 'MANAGER', 'LEADERSHIP', 'OWNER'];
    const isElevated = ['SUPER_ADMIN', 'ADMIN', 'HR', 'LEADERSHIP', 'OWNER'].includes(req.user.role);

    for (const targetId of targetEmployeeIds) {
      if (targetId === req.user.id) continue;

      if (!allowedRoles.includes(req.user.role)) {
        return res.status(403).json({
          error: 'Access forbidden: you do not have permission to assign goals to other employees',
        });
      }

      if (req.user.role === 'MANAGER' || !isElevated) {
        const isSubordinate = await checkIsSubordinate(req.user.id, targetId, req.tenantId);
        if (!isSubordinate) {
          const unauthorizedUser = targetUsers.find(u => u.id === targetId);
          return res.status(403).json({
            error: `Access forbidden: employee "${unauthorizedUser?.name || targetId}" is not in your reporting downline`,
          });
        }
      }
    }

    // Execute atomic creation in transaction
    const { goal, assignments } = await prisma.$transaction(async (tx) => {
      const createdGoal = await tx.goal.create({
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
          dueDate: dueDate ? new Date(dueDate) : (targetDate ? new Date(targetDate) : undefined),
          attachments: attachments || [],
          specialNotes: specialNotes || null,
          employeeId: targetEmployeeIds[0],
          createdBy: req.user.name,
          status: 'DRAFT',
        },
      });

      const createdAssignments = await Promise.all(
        targetEmployeeIds.map((empId) =>
          tx.goalAssignment.create({
            data: {
              tenantId: req.tenantId,
              goalId: createdGoal.id,
              employeeId: empId,
              assignedById: req.user.id,
              progress: 0,
              status: 'DRAFT',
              milestones: 0,
              completedMilestones: 0,
            },
            include: {
              employee: { select: { id: true, name: true, email: true, department: true, designation: true } },
            },
          })
        )
      );

      await tx.goalAuditLog.create({
        data: {
          goalId: createdGoal.id,
          performedById: req.user.id,
          action: 'GOAL_CREATED',
          details: `${req.user.name} created goal "${createdGoal.title}" and assigned to ${targetEmployeeIds.length} employee(s).`,
        },
      });

      return { goal: createdGoal, assignments: createdAssignments };
    });

    // Notify assigned employees
    for (const empId of targetEmployeeIds) {
      if (empId !== req.user.id) {
        await goalService.notify({
          tenantId: req.tenantId,
          recipientId: empId,
          type: 'goal_update',
          title: `New Goal Assigned: "${goal.title}"`,
          body: `${req.user.name} assigned goal "${goal.title}" to you.`,
          entityType: 'goal',
          entityId: goal.id,
        });
      }
    }

    const fullGoal = await prisma.goal.findUnique({
      where: { id: goal.id },
      include: {
        employee: { select: { id: true, name: true, email: true, department: true, designation: true, role: true, managerId: true } },
        assignments: {
          include: {
            employee: { select: { id: true, name: true, email: true, department: true, designation: true, role: true, managerId: true } },
            assignedBy: { select: { id: true, name: true, role: true } },
          },
        },
        tasks: true,
      },
    });

    res.status(201).json(fullGoal);
  } catch (err) {
    next(err);
  }
}

export async function listGoals(req, res, next) {
  try {
    const { employeeId, status, financialYear, category, scope } = req.query;

    const where = { tenantId: req.tenantId };
    const isElevated = ['SUPER_ADMIN', 'ADMIN', 'HR', 'LEADERSHIP', 'OWNER'].includes(req.user.role);

    if (employeeId && employeeId !== 'all') {
      const targetUser = await prisma.tenantUser.findFirst({
        where: { id: employeeId, tenantId: req.tenantId },
      });
      if (!targetUser) {
        return res.status(400).json({ error: 'Target employee not found in this organization' });
      }

      if (employeeId !== req.user.id && !isElevated) {
        const isSubordinate = await checkIsSubordinate(req.user.id, employeeId, req.tenantId);
        if (!isSubordinate) {
          return res.status(403).json({ error: 'Access forbidden: user is not your subordinate' });
        }
      }

      where.OR = [
        { employeeId: employeeId },
        { assignments: { some: { employeeId: employeeId } } },
      ];
    } else {
      // No employeeId passed OR employeeId === 'all' OR scope === 'team'
      if (req.user.role === 'EMPLOYEE' && !isElevated) {
        // Regular employee can only ever see their own goals
        where.OR = [
          { employeeId: req.user.id },
          { assignments: { some: { employeeId: req.user.id } } },
        ];
      } else if (req.user.role === 'MANAGER') {
        // Manager can see:
        // 1. Goals assigned to self
        // 2. Goals assigned to downline employees (including HR/Admin created goals!)
        // 3. Goals created by self
        const allTenantUsers = await prisma.tenantUser.findMany({
          where: { tenantId: req.tenantId, status: 'ACTIVE' },
          select: { id: true, managerId: true },
        });

        const directReportsMap = {};
        allTenantUsers.forEach(u => {
          if (u.managerId) {
            if (!directReportsMap[u.managerId]) directReportsMap[u.managerId] = [];
            directReportsMap[u.managerId].push(u.id);
          }
        });

        const downlineIds = [];
        const queue = [req.user.id];
        const visited = new Set();
        while (queue.length > 0) {
          const currentId = queue.shift();
          if (visited.has(currentId)) continue;
          visited.add(currentId);

          const reports = directReportsMap[currentId] || [];
          reports.forEach(rId => {
            downlineIds.push(rId);
            queue.push(rId);
          });
        }

        const allowedUserIds = [req.user.id, ...downlineIds];

        where.OR = [
          { employeeId: { in: allowedUserIds } },
          { assignments: { some: { employeeId: { in: allowedUserIds } } } },
          { createdBy: req.user.name },
        ];
      } else if (isElevated) {
        // HR/Admin: If employeeId is not specified and not 'all', default to own or tenant
        if (!employeeId) {
          where.OR = [
            { employeeId: req.user.id },
            { assignments: { some: { employeeId: req.user.id } } },
          ];
        }
        // If employeeId === 'all', no restriction on where.employeeId, view tenant wide
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
        assignments: {
          include: {
            employee: {
              select: { id: true, name: true, email: true, department: true, designation: true, managerId: true },
            },
            assignedBy: {
              select: { id: true, name: true, role: true },
            },
          },
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
        assignments: {
          include: {
            employee: {
              select: { id: true, name: true, email: true, department: true, designation: true, managerId: true },
            },
            assignedBy: {
              select: { id: true, name: true, role: true },
            },
          },
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

    // IDOR Protection: Verify caller is elevated, assignee, creator, or downline manager
    const isElevated = ['SUPER_ADMIN', 'ADMIN', 'HR', 'LEADERSHIP', 'OWNER'].includes(req.user.role);
    const isOwner = goal.employeeId === req.user.id || (goal.assignments && goal.assignments.some(a => a.employeeId === req.user.id));
    let isAuthorizedManager = false;
    if (req.user.role === 'MANAGER' || !isElevated) {
      for (const a of (goal.assignments || [])) {
        if (await checkIsSubordinate(req.user.id, a.employeeId, req.tenantId)) {
          isAuthorizedManager = true;
          break;
        }
      }
      if (!isAuthorizedManager && goal.employeeId) {
        isAuthorizedManager = await checkIsSubordinate(req.user.id, goal.employeeId, req.tenantId);
      }
    }

    if (!isElevated && !isOwner && !isAuthorizedManager && goal.createdBy !== req.user.name) {
      return res.status(403).json({ error: 'Access forbidden: you do not have permission to view this goal' });
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
      include: { assignments: true },
    });

    if (!existing) {
      return res.status(404).json({ error: 'Goal not found' });
    }

    const isOwner = existing.employeeId === req.user.id || existing.assignments.some(a => a.employeeId === req.user.id);
    const isElevated = ['SUPER_ADMIN', 'ADMIN', 'HR'].includes(req.user.role);
    let isManager = false;
    if (!isOwner && !isElevated) {
      for (const a of existing.assignments) {
        if (await checkIsSubordinate(req.user.id, a.employeeId, req.tenantId)) {
          isManager = true;
          break;
        }
      }
      if (!isManager && existing.employeeId) {
        isManager = await checkIsSubordinate(req.user.id, existing.employeeId, req.tenantId);
      }
      if (!isManager && existing.createdBy !== req.user.name) {
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
        assignments: {
          include: {
            employee: { select: { id: true, name: true, email: true, department: true, designation: true, role: true, managerId: true } },
          },
        },
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
      include: { assignments: true },
    });

    if (!goal) {
      return res.status(404).json({ error: 'Goal not found' });
    }

    const isElevated = ['SUPER_ADMIN', 'ADMIN', 'HR'].includes(req.user.role);
    const isOwner = goal.employeeId === req.user.id || (goal.assignments.length === 1 && goal.assignments[0].employeeId === req.user.id);
    let isAuthorizedManager = false;
    if (req.user.role === 'MANAGER' || !isElevated) {
      for (const a of goal.assignments) {
        if (await checkIsSubordinate(req.user.id, a.employeeId, req.tenantId)) {
          isAuthorizedManager = true;
          break;
        }
      }
      if (!isAuthorizedManager && goal.employeeId) {
        isAuthorizedManager = await checkIsSubordinate(req.user.id, goal.employeeId, req.tenantId);
      }
    }

    if (!isElevated && !isOwner && !isAuthorizedManager && goal.createdBy !== req.user.name) {
      return res.status(403).json({ error: 'Access forbidden: you do not have permission to delete this goal' });
    }

    await prisma.goal.delete({
      where: { id },
    });

    res.json({ success: true, message: 'Goal deleted successfully' });
  } catch (err) {
    next(err);
  }
}

// ── Workflow Action Handlers ───────────────────────────────────────────────

export async function submitGoal(req, res, next) {
  try {
    const { id } = req.params;
    const parsed = goalSubmitSchema.safeParse(req.body || {});
    if (!parsed.success) {
      return res.status(400).json({ error: 'Validation failed', details: parsed.error.issues });
    }
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
    const parsed = goalApproveSchema.safeParse(req.body || {});
    if (!parsed.success) {
      return res.status(400).json({ error: 'Validation failed', details: parsed.error.issues });
    }
    const { comment, rating, employeeId, targetEmployeeId } = parsed.data;
    const result = await goalService.managerReview({
      tenantId: req.tenantId,
      goalId: id,
      user: req.user,
      action: 'APPROVE',
      comment,
      rating,
      targetEmployeeId: targetEmployeeId || employeeId,
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
    const parsed = goalRejectSchema.safeParse(req.body || {});
    if (!parsed.success) {
      return res.status(400).json({ error: 'Validation failed', details: parsed.error.issues });
    }
    const { comment, employeeId, targetEmployeeId } = parsed.data;
    const result = await goalService.managerReview({
      tenantId: req.tenantId,
      goalId: id,
      user: req.user,
      action: 'REJECT',
      comment,
      targetEmployeeId: targetEmployeeId || employeeId,
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
    const parsed = goalApproveSchema.safeParse(req.body || {});
    if (!parsed.success) {
      return res.status(400).json({ error: 'Validation failed', details: parsed.error.issues });
    }
    const { comment, rating, employeeId, targetEmployeeId } = parsed.data;
    const result = await goalService.hrReview({
      tenantId: req.tenantId,
      goalId: id,
      user: req.user,
      action: 'APPROVE',
      comment,
      rating,
      targetEmployeeId: targetEmployeeId || employeeId,
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
    const parsed = goalRejectSchema.safeParse(req.body || {});
    if (!parsed.success) {
      return res.status(400).json({ error: 'Validation failed', details: parsed.error.issues });
    }
    const { comment, employeeId, targetEmployeeId } = parsed.data;
    const result = await goalService.hrReview({
      tenantId: req.tenantId,
      goalId: id,
      user: req.user,
      action: 'REJECT',
      comment,
      targetEmployeeId: targetEmployeeId || employeeId,
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
    const parsed = goalResubmitSchema.safeParse(req.body || {});
    if (!parsed.success) {
      return res.status(400).json({ error: 'Validation failed', details: parsed.error.issues });
    }
    const { comment } = parsed.data;
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

