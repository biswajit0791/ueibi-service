import { prisma } from '../lib/prisma.js';
import {
  createGoalSchema,
  updateGoalSchema,
  goalReviewSchema,
  activateApproveSchema,
} from '../validations/goal.schema.js';
import { goalService, GOAL_CATEGORIES, GOAL_TYPES, GOAL_PRIORITIES, GOAL_STATUS } from '../services/goal.service.js';

/**
 * Traverses up the reporting chain from targetId to see if managerId is encountered.
 */
async function checkIsSubordinate(managerId, targetId, tenantId) {
  return goalService.isSubordinate(managerId, targetId, tenantId);
}

// ── Metadata Endpoints ─────────────────────────────────────────────────────

export async function getGoalCategories(req, res) {
  res.json({ categories: GOAL_CATEGORIES });
}

export async function getGoalTypes(req, res) {
  res.json({ types: GOAL_TYPES });
}

export async function getGoalPriorities(req, res) {
  res.json({ priorities: GOAL_PRIORITIES });
}

/**
 * GET /goals/assignable-users
 *
 * Returns the list of employees this user is allowed to assign goals to.
 *
 * EMPLOYEE / non-managers  → only self
 * MANAGER                  → self + full reporting downline (recursive)
 * SUPER_ADMIN / ADMIN / HR → all active users in tenant
 */
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

// ── Goal CRUD ──────────────────────────────────────────────────────────────

/**
 * POST /goals
 *
 * Creates a new goal with the correct initial status based on:
 *
 *   A. EMPLOYEE self-assignment (employeeId == caller or omitted):
 *      status = DRAFT  (existing behaviour preserved)
 *      approvalMode not stored
 *
 *   B. MANAGER assigns to another employee with MANAGER_APPROVAL:
 *      status = PENDING_APPROVAL
 *      Reporting manager must call activate-approve before tasks start.
 *
 *   C. MANAGER assigns to another employee with AUTO_APPROVE:
 *      status = ACTIVE  (tasks immediately workable)
 *
 * In all cases, createdById is stored for proper audit trail.
 */
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
      employeeId,
      approvalMode,
    } = parsed.data;

    if (!title) {
      return res.status(400).json({ error: 'Goal title is required' });
    }

    // Determine target employee (default: self)
    const targetEmployeeId = employeeId || req.user.id;
    const isSelfAssigned = targetEmployeeId === req.user.id;

    // Verify tenant isolation — target must belong to same tenant
    const targetUser = await prisma.tenantUser.findFirst({
      where: { id: targetEmployeeId, tenantId: req.tenantId },
      select: { id: true, name: true, managerId: true },
    });
    if (!targetUser) {
      return res.status(400).json({ error: 'Target employee not found in this organization' });
    }

    // ── Authorization ──────────────────────────────────────────────────────
    if (!isSelfAssigned) {
      // Only elevated roles / managers can create goals for others
      const allowedRoles = ['SUPER_ADMIN', 'ADMIN', 'HR', 'MANAGER', 'LEADERSHIP', 'OWNER'];
      if (!allowedRoles.includes(req.user.role)) {
        return res.status(403).json({
          error: 'Access forbidden: you do not have permission to assign goals to other employees',
        });
      }

      // MANAGER can only assign to their downline
      if (req.user.role === 'MANAGER') {
        const isSubordinate = await checkIsSubordinate(req.user.id, targetEmployeeId, req.tenantId);
        if (!isSubordinate) {
          return res.status(403).json({
            error: 'Access forbidden: employee is not in your reporting downline',
          });
        }
      }
    }

    // ── Determine initial status ───────────────────────────────────────────
    // Self-assigned goals always start as DRAFT (existing behaviour preserved).
    // Manager-created goals use approvalMode to set the initial status.
    let initialStatus;
    let effectiveApprovalMode = null;

    if (isSelfAssigned) {
      // Flow A: Employee self-created → DRAFT
      initialStatus = GOAL_STATUS.DRAFT;
    } else if (approvalMode === 'AUTO_APPROVE') {
      // Flow C: Manager + AUTO_APPROVE → ACTIVE immediately
      initialStatus = GOAL_STATUS.ACTIVE;
      effectiveApprovalMode = 'AUTO_APPROVE';
    } else {
      // Flow B: Manager + MANAGER_APPROVAL (default for manager-created) → PENDING_APPROVAL
      initialStatus = GOAL_STATUS.PENDING_APPROVAL;
      effectiveApprovalMode = 'MANAGER_APPROVAL';
    }

    // ── Create goal ────────────────────────────────────────────────────────
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
        createdBy: req.user.name,          // legacy name string (preserved)
        createdById: req.user.id,           // new: proper FK for audit/query
        approvalMode: effectiveApprovalMode,
        status: initialStatus,
      },
      include: {
        employee: {
          select: { id: true, name: true, email: true, department: true, designation: true, managerId: true },
        },
        tasks: true,
      },
    });

    // ── Audit log ──────────────────────────────────────────────────────────
    let auditDetails = `${req.user.name} created goal "${goal.title}"`;
    if (!isSelfAssigned) {
      auditDetails += ` and assigned it to ${targetUser.name}`;
      auditDetails += ` (approval mode: ${effectiveApprovalMode})`;
    }
    auditDetails += `.`;

    await goalService.logAudit({
      goalId: goal.id,
      performedById: req.user.id,
      action: 'GOAL_CREATED',
      details: auditDetails,
    });

    // ── Notifications ──────────────────────────────────────────────────────
    if (!isSelfAssigned) {
      if (initialStatus === GOAL_STATUS.PENDING_APPROVAL) {
        // Notify assignee that a goal was created for them (pending activation)
        await goalService.notify({
          tenantId: req.tenantId,
          recipientId: targetEmployeeId,
          type: 'goal_update',
          title: `New Goal Assigned: "${goal.title}"`,
          body: `${req.user.name} created a goal for you. It is awaiting manager approval before you can begin.`,
          entityType: 'goal',
          entityId: goal.id,
        });

        // Notify the assignee's reporting manager to activate the goal
        if (targetUser.managerId && targetUser.managerId !== req.user.id) {
          await goalService.notify({
            tenantId: req.tenantId,
            recipientId: targetUser.managerId,
            type: 'goal_update',
            title: `Goal Activation Required: "${goal.title}"`,
            body: `${req.user.name} created a goal for ${targetUser.name} that requires your approval to activate.`,
            entityType: 'goal',
            entityId: goal.id,
          });
        }
      } else if (initialStatus === GOAL_STATUS.ACTIVE) {
        // AUTO_APPROVE: notify assignee that the goal is immediately active
        await goalService.notify({
          tenantId: req.tenantId,
          recipientId: targetEmployeeId,
          type: 'goal_update',
          title: `New Goal Activated: "${goal.title}"`,
          body: `${req.user.name} created and auto-approved a goal for you. You can start working on tasks now.`,
          entityType: 'goal',
          entityId: goal.id,
        });
      }
    }

    res.status(201).json(goal);
  } catch (err) {
    next(err);
  }
}

/**
 * GET /goals
 */
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
      where.employeeId = req.user.id;
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
        createdByUser: {
          select: { id: true, name: true, role: true },
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

/**
 * GET /goals/:id
 */
export async function getGoalById(req, res, next) {
  try {
    const { id } = req.params;

    const goal = await prisma.goal.findFirst({
      where: { id, tenantId: req.tenantId },
      include: {
        employee: {
          select: { id: true, name: true, email: true, department: true, designation: true, managerId: true },
        },
        createdByUser: {
          select: { id: true, name: true, role: true },
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

/**
 * PATCH /goals/:id
 */
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

    // Prevent direct status manipulation through the generic update endpoint.
    // Status changes must go through dedicated workflow action endpoints.
    const { status: _ignoredStatus, ...safeData } = parsed.data;

    const updated = await prisma.goal.update({
      where: { id },
      data: {
        ...(safeData.title ? { title: safeData.title.trim() } : {}),
        ...(safeData.description !== undefined ? { description: safeData.description } : {}),
        ...(safeData.category ? { category: safeData.category } : {}),
        ...(safeData.goalType ? { goalType: safeData.goalType } : {}),
        ...(safeData.priority ? { priority: safeData.priority } : {}),
        ...(safeData.financialYear ? { financialYear: safeData.financialYear } : {}),
        ...(safeData.quarter ? { quarter: safeData.quarter } : {}),
        ...(safeData.startDate ? { startDate: new Date(safeData.startDate) } : {}),
        ...(safeData.targetDate ? { targetDate: new Date(safeData.targetDate) } : {}),
        ...(safeData.attachments ? { attachments: safeData.attachments } : {}),
        ...(safeData.specialNotes !== undefined ? { specialNotes: safeData.specialNotes } : {}),
      },
      include: {
        employee: true,
        createdByUser: { select: { id: true, name: true, role: true } },
        tasks: true,
        auditLogs: {
          orderBy: { createdAt: 'desc' },
          include: { performedBy: { select: { id: true, name: true, role: true } } },
        },
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

/**
 * DELETE /goals/:id
 */
export async function deleteGoal(req, res, next) {
  try {
    const { id } = req.params;

    const goal = await prisma.goal.findFirst({
      where: { id, tenantId: req.tenantId },
    });

    if (!goal) {
      return res.status(404).json({ error: 'Goal not found' });
    }

    // Only owner (for DRAFT goals) or HR/Admin can delete
    if (goal.employeeId !== req.user.id && req.user.role !== 'SUPER_ADMIN' && req.user.role !== 'HR') {
      const isSubordinate = await checkIsSubordinate(req.user.id, goal.employeeId, req.tenantId);
      if (!isSubordinate) {
        return res.status(403).json({ error: 'Access forbidden' });
      }
    }

    await prisma.goal.delete({ where: { id } });

    res.json({ success: true });
  } catch (err) {
    next(err);
  }
}

// ── Workflow Action Handlers ───────────────────────────────────────────────

/**
 * POST /goals/:id/activate-approve
 *
 * Transitions a PENDING_APPROVAL goal → ACTIVE.
 *
 * Who can call:
 *  - The goal-owner's reporting manager
 *  - HR / SUPER_ADMIN / ADMIN
 *
 * This is the initial activation step for MANAGER + MANAGER_APPROVAL goals.
 * It is NOT the same as the post-submission manager review (/approve).
 */
export async function activateApproveGoal(req, res, next) {
  try {
    const { id } = req.params;
    const parsed = activateApproveSchema.safeParse(req.body || {});
    if (!parsed.success) {
      return res.status(400).json({ error: 'Validation failed', details: parsed.error.issues });
    }
    const result = await goalService.activateGoal({
      tenantId: req.tenantId,
      goalId: id,
      user: req.user,
      comment: parsed.data.comment,
    });
    res.json(result);
  } catch (err) {
    if (err.status) {
      return res.status(err.status).json({ error: err.message });
    }
    next(err);
  }
}

/**
 * POST /goals/:id/submit
 *
 * Employee submits a completed goal for manager/HR review.
 * Allowed from: DRAFT (self-created) | ACTIVE (manager-created) | CHANGES_REQUESTED
 */
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

/**
 * POST /goals/:id/approve
 *
 * Manager approves a submitted goal → PENDING_HR_REVIEW.
 * This is the POST-SUBMISSION review, not the initial activation.
 */
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

/**
 * POST /goals/:id/reject
 *
 * Manager requests changes on a submitted goal → CHANGES_REQUESTED.
 */
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

/**
 * POST /goals/:id/hr-approve
 *
 * HR approves final goal → COMPLETED.
 */
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

/**
 * POST /goals/:id/hr-reject
 *
 * HR requests changes → CHANGES_REQUESTED.
 */
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

/**
 * POST /goals/:id/resubmit
 *
 * Employee resubmits after CHANGES_REQUESTED.
 */
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
