import { prisma } from '../lib/prisma.js';
import {
  createGoalSchema,
  updateGoalSchema,
  goalReviewSchema,
  activateApproveSchema,
  goalSubmitSchema,
  goalApproveSchema,
  goalRejectSchema,
  goalResubmitSchema,
} from '../validations/goal.schema.js';
import { goalService, GOAL_CATEGORIES, GOAL_TYPES, GOAL_PRIORITIES, GOAL_STATUS } from '../services/goal.service.js';
import { ELEVATED_ROLES, hasRole } from '../lib/roles.js';
import { getCurrentFinancialYear, getCurrentQuarter } from '../lib/financialYear.js';
import { GOAL_EDITABLE_STATUSES } from '../lib/workflowStatus.js';

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

    if (hasRole(role, ELEVATED_ROLES)) {
      const users = await prisma.tenantUser.findMany({
        where: { tenantId, status: 'ACTIVE', isDeleted: false },
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
      where: { tenantId, status: 'ACTIVE', isDeleted: false },
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
      dueDate,
      attachments,
      specialNotes,
      employeeId,
      employeeIds: rawEmployeeIds,
      approvalMode,
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

    // If 'all' was passed (e.g. from a filter dropdown or company-wide assignment), expand it
    if (targetEmployeeIds.includes('all')) {
      const isElevated = hasRole(req.user.role, ELEVATED_ROLES);
      if (isElevated) {
        const allTenantUsers = await prisma.tenantUser.findMany({
          where: { tenantId: req.tenantId, status: 'ACTIVE', isDeleted: false },
          select: { id: true },
        });
        const expandedIds = allTenantUsers.map((u) => u.id);
        targetEmployeeIds = targetEmployeeIds.filter((id) => id !== 'all').concat(expandedIds);
      } else if (req.user.role === 'MANAGER') {
        const downlineUsers = await prisma.tenantUser.findMany({
          where: { tenantId: req.tenantId, managerId: req.user.id, status: 'ACTIVE', isDeleted: false },
          select: { id: true },
        });
        const expandedIds = downlineUsers.map((u) => u.id);
        targetEmployeeIds = targetEmployeeIds.filter((id) => id !== 'all').concat(expandedIds.length > 0 ? expandedIds : [req.user.id]);
      } else {
        targetEmployeeIds = targetEmployeeIds.filter((id) => id !== 'all').concat([req.user.id]);
      }
    }

    // Normalize and deduplicate IDs
    targetEmployeeIds = [...new Set(targetEmployeeIds.filter(Boolean))];

    if (targetEmployeeIds.length === 0) {
      targetEmployeeIds = [req.user.id];
    }

    const isSelfAssigned = targetEmployeeIds.length === 1 && targetEmployeeIds[0] === req.user.id;

    // Verify all target employees exist in tenant and are active
    const targetUsers = await prisma.tenantUser.findMany({
      where: {
        id: { in: targetEmployeeIds },
        tenantId: req.tenantId,
        status: 'ACTIVE',
        isDeleted: false,
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
    const isElevated = hasRole(req.user.role, ELEVATED_ROLES);
    const canAssignToOthers = isElevated || String(req.user.role || '').toUpperCase() === 'MANAGER';

    for (const targetId of targetEmployeeIds) {
      if (targetId === req.user.id) continue;

      if (!canAssignToOthers) {
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
          financialYear: financialYear || getCurrentFinancialYear(),
          quarter: quarter || getCurrentQuarter(),
          startDate: startDate ? new Date(startDate) : undefined,
          targetDate: targetDate ? new Date(targetDate) : undefined,
          dueDate: dueDate ? new Date(dueDate) : (targetDate ? new Date(targetDate) : undefined),
          attachments: attachments || [],
          specialNotes: specialNotes || null,
          employeeId: targetEmployeeIds[0],
          createdBy: req.user.name,
          createdById: req.user.id,
          approvalMode: effectiveApprovalMode,
          status: initialStatus,
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
              status: initialStatus,
              milestones: 0,
              completedMilestones: 0,
            },
            include: {
              employee: { select: { id: true, name: true, email: true, department: true, designation: true } },
            },
          })
        )
      );

      let auditDetails = `${req.user.name} created goal "${createdGoal.title}"`;
      if (!isSelfAssigned) {
        auditDetails += ` and assigned it to ${targetEmployeeIds.length} employee(s)`;
        auditDetails += ` (approval mode: ${effectiveApprovalMode})`;
      }
      auditDetails += `.`;

      await tx.goalAuditLog.create({
        data: {
          goalId: createdGoal.id,
          performedById: req.user.id,
          action: 'GOAL_CREATED',
          details: auditDetails,
        },
      });

      return { goal: createdGoal, assignments: createdAssignments };
    });

    // ── Notifications ──────────────────────────────────────────────────────
    if (!isSelfAssigned) {
      for (const targetUser of targetUsers) {
        if (targetUser.id === req.user.id) continue;

        if (initialStatus === GOAL_STATUS.PENDING_APPROVAL) {
          // Notify assignee that a goal was created for them (pending activation)
          await goalService.notify({
            tenantId: req.tenantId,
            recipientId: targetUser.id,
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
            recipientId: targetUser.id,
            type: 'goal_update',
            title: `New Goal Activated: "${goal.title}"`,
            body: `${req.user.name} created and auto-approved a goal for you. You can start working on tasks now.`,
            entityType: 'goal',
            entityId: goal.id,
          });
        }
      }
    }

    const fullGoal = await prisma.goal.findUnique({
      where: { id: goal.id },
      include: {
        employee: { select: { id: true, name: true, email: true, department: true, designation: true, role: true, managerId: true } },
        createdByUser: { select: { id: true, name: true, role: true } },
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

/**
 * GET /goals
 */
export async function listGoals(req, res, next) {
  try {
    const { employeeId, status, financialYear, category, scope } = req.query;

    // Pagination (backwards compatible: callers that don't pass `page` still get
    // a single page, just capped so a huge tenant can't return thousands of
    // deeply-included goal trees in one response).
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(200, Math.max(1, parseInt(req.query.limit, 10) || 100));
    const skip = (page - 1) * limit;

    const where = { tenantId: req.tenantId };
    const isElevated = hasRole(req.user.role, ELEVATED_ROLES);

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
          where: { tenantId: req.tenantId, status: 'ACTIVE', isDeleted: false },
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
          { createdById: req.user.id },
          { createdBy: req.user.name }, // legacy rows without createdById
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

    const [total, items] = await Promise.all([
      prisma.goal.count({ where }),
      prisma.goal.findMany({
        where,
        include: {
          employee: {
            select: { id: true, name: true, email: true, department: true, designation: true, managerId: true },
          },
          createdByUser: {
            select: { id: true, name: true, role: true },
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
        skip,
        take: limit,
      }),
    ]);

    res.json({
      items,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit) || 1,
      },
    });
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

    // IDOR protection: elevated role, primary/assignee, creator, or downline manager
    const canAccess = await goalService.canAccessGoal(goal, req.user, req.tenantId);
    if (!canAccess) {
      return res.status(403).json({ error: 'Access forbidden: you do not have permission to view this goal' });
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
      include: { assignments: true },
    });

    if (!existing) {
      return res.status(404).json({ error: 'Goal not found' });
    }

    const canAccess = await goalService.canAccessGoal(existing, req.user, req.tenantId);
    if (!canAccess) {
      return res.status(403).json({ error: 'Access forbidden: you cannot edit this goal' });
    }

    // A plain edit is only allowed while the goal is still being worked on.
    // Once it has entered the review workflow (PENDING_MANAGER_REVIEW, etc.) the
    // dedicated workflow endpoints must be used instead.
    if (!GOAL_EDITABLE_STATUSES.includes(existing.status) && !hasRole(req.user.role, ELEVATED_ROLES)) {
      return res.status(409).json({
        error: `Goal cannot be edited while it is in "${existing.status}". Use the review workflow actions instead.`,
      });
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
        ...(safeData.dueDate ? { dueDate: new Date(safeData.dueDate) } : {}),
        ...(safeData.attachments ? { attachments: safeData.attachments } : {}),
        ...(safeData.specialNotes !== undefined ? { specialNotes: safeData.specialNotes } : {}),
      },
      include: {
        employee: true,
        createdByUser: { select: { id: true, name: true, role: true } },
        assignments: {
          include: {
            employee: { select: { id: true, name: true, email: true, department: true, designation: true, role: true, managerId: true } },
          },
        },
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
      include: { assignments: true },
    });

    if (!goal) {
      return res.status(404).json({ error: 'Goal not found' });
    }

    const isElevated = hasRole(req.user.role, ELEVATED_ROLES);
    const isCreator = (goal.createdById && goal.createdById === req.user.id)
      || (!goal.createdById && goal.createdBy === req.user.name);
    let isAuthorizedManager = false;
    if (!isElevated && !isCreator) {
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

    if (!isElevated && !isCreator && !isAuthorizedManager) {
      return res.status(403).json({ error: 'Access forbidden: you do not have permission to delete this goal' });
    }

    // A completed goal is part of the appraisal record — only elevated roles may remove it.
    if (goal.status === 'COMPLETED' && !isElevated) {
      return res.status(409).json({ error: 'A completed goal can only be removed by HR / Admin.' });
    }

    // Detach linked tasks (convert to standalone) BEFORE deleting the goal so the
    // `onDelete: Cascade` on Task.goalId doesn't silently wipe employees' task
    // history, comments and audit logs.
    await prisma.$transaction([
      prisma.task.updateMany({
        where: { goalId: id },
        data: { goalId: null, isStandalone: true },
      }),
      prisma.goal.delete({ where: { id } }),
    ]);

    res.json({ success: true, message: 'Goal deleted successfully' });
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

/**
 * POST /goals/:id/approve
 *
 * Manager approves a submitted goal → PENDING_HR_REVIEW.
 * This is the POST-SUBMISSION review, not the initial activation.
 */
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

/**
 * POST /goals/:id/reject
 *
 * Manager requests changes on a submitted goal → CHANGES_REQUESTED.
 */
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

/**
 * POST /goals/:id/hr-approve
 *
 * HR approves final goal → COMPLETED.
 */
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

/**
 * POST /goals/:id/hr-reject
 *
 * HR requests changes → CHANGES_REQUESTED.
 */
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

/**
 * POST /goals/:id/resubmit
 *
 * Employee resubmits after CHANGES_REQUESTED.
 */
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

