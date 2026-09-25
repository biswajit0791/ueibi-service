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
  goalIdParamSchema,
  listGoalsQuerySchema,
} from '../validations/goal.schema.js';
import { goalService, GOAL_CATEGORIES, GOAL_TYPES, GOAL_PRIORITIES, GOAL_STATUS } from '../services/goal.service.js';
import { goalWeightSummary, summariseGoals } from '../services/goalWeight.service.js';
import { taskTiming } from '../lib/taskTiming.js';
import goalOptionService from '../services/goalOption.service.js';
import { ELEVATED_ROLES, SUPER_ELEVATED_ROLES, MANAGER_OR_ELEVATED_ROLES, hasRole, canViewDashboard } from '../lib/roles.js';
import { getCurrentFinancialYear, getCurrentQuarter } from '../lib/financialYear.js';
import { GOAL_EDITABLE_STATUSES } from '../lib/workflowStatus.js';

/**
 * Traverses up the reporting chain from targetId to see if managerId is encountered.
 */
async function checkIsSubordinate(managerId, targetId, tenantId) {
  return goalService.isSubordinate(managerId, targetId, tenantId);
}

// ── Metadata Endpoints ─────────────────────────────────────────────────────

// These three now read the tenant's own master lists instead of a hardcoded
// constant. The RESPONSE SHAPE IS UNCHANGED on purpose — GoalForm.jsx and any
// other consumer keep working with no edit. The constants survive as the seed
// for a tenant that has never configured its lists.
export async function getGoalCategories(req, res) {
  try {
    res.json({ categories: await goalOptionService.listValues({ tenantId: req.tenantId, kind: 'CATEGORY' }) });
  } catch {
    res.json({ categories: GOAL_CATEGORIES });
  }
}

export async function getGoalTypes(req, res) {
  try {
    res.json({ types: await goalOptionService.listValues({ tenantId: req.tenantId, kind: 'TYPE' }) });
  } catch {
    res.json({ types: GOAL_TYPES });
  }
}

export async function getGoalPriorities(req, res) {
  try {
    res.json({ priorities: await goalOptionService.listValues({ tenantId: req.tenantId, kind: 'PRIORITY' }) });
  } catch {
    res.json({ priorities: GOAL_PRIORITIES });
  }
}

/** Full option objects (label, colour, order) for the admin screen and chips. */
export async function getGoalOptions(req, res, next) {
  try {
    const options = await goalOptionService.listAllWithUsage({ tenantId: req.tenantId });
    res.json({ options });
  } catch (err) { next(err); }
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

    if (hasRole(role, ['SUPER_ADMIN', 'ADMIN', 'CMD', 'HR', 'FINANCE'])) {
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

      // Filter by role hierarchy: caller can only see/select boards they have authority to view, plus self
      const filteredUsers = users.filter((u) => u.id === req.user.id || canViewDashboard(role, u.role));
      return res.json({ users: filteredUsers });
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

    const higherRoles = ['SUPER_ADMIN', 'ADMIN', 'CMD', 'HR', 'FINANCE', 'DIRECTOR', 'LEADERSHIP', 'OWNER', 'MANAGER'];

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
          // A manager cannot have higher authority roles or peer managers in their downline
          const reportRole = String(r.role || '').toUpperCase();
          if (!higherRoles.includes(reportRole) || r.managerId === req.user.id) {
            downline.push(r);
            queue.push(r.id);
          }
        });
      }

      // Allow manager to assign to themselves as well (self-assignment)
      const selfUser = allUsers.find(u => u.id === req.user.id);
      if (selfUser && !downline.some(d => d.id === selfUser.id)) {
        downline.push(selfUser);
      }

      // If downline only contains self (no subordinates mapped via managerId yet),
      // allow Manager to manage members in their department or active tenant employees with role EMPLOYEE / STUDENT
      if (role === 'MANAGER' && downline.length <= 1) {
        const deptUsers = req.user.department
          ? allUsers.filter(u => u.department === req.user.department && !higherRoles.includes(String(u.role || '').toUpperCase()))
          : [];
        const fallbackUsers = deptUsers.length > 0
          ? deptUsers
          : allUsers.filter(u => ['EMPLOYEE', 'STUDENT'].includes(String(u.role || '').toUpperCase()));
        fallbackUsers.forEach(u => {
          if (!downline.some(d => d.id === u.id)) {
            downline.push(u);
          }
        });
      }

      // Strict filter: managers must NEVER see peer managers or higher authority roles (HR, CMD, Finance, Admin)
      const filteredDownline = downline.filter(u => u.id === req.user.id || !higherRoles.includes(String(u.role || '').toUpperCase()));
      filteredDownline.sort((a, b) => a.name.localeCompare(b.name));
      return res.json({ users: filteredDownline });
    }

    // For standard EMPLOYEE with no reports: strictly only allow self-assignment
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
 *   A. Self-assignment (employeeId == caller or omitted, any role):
 *      status = DRAFT  (existing behaviour preserved)
 *      approvalMode not stored
 *
 *   B. Elevated role (ADMIN/HR/CMD/SUPER_ADMIN) or MANAGER assigns to another
 *      employee with MANAGER_APPROVAL:
 *      status = PENDING_APPROVAL
 *      Reporting manager must call activate-approve before tasks start.
 *
 *   C. Elevated role or MANAGER assigns to another employee with AUTO_APPROVE:
 *      status = ACTIVE  (tasks immediately workable)
 *
 * In all cases, createdById is stored for proper audit trail.
 */
/**
 * Priority moved from a fixed z.enum to a tenant-managed master list, so
 * membership has to be checked here — the schema cannot know the tenant.
 *
 * Only validates a priority the caller actually SET. An update that leaves
 * priority alone is untouched, so a goal created before an option was archived
 * can still be edited. Returns null when fine, or a 400 body when not.
 */
async function checkPriorityAllowed(tenantId, priority) {
  if (priority === undefined || priority === null || priority === '') return null;
  const allowed = await goalOptionService.allowedValues({ tenantId, kind: 'PRIORITY' });
  if (allowed.includes(priority)) return null;
  return {
    error: 'Validation failed',
    details: [{ field: 'priority', message: `Priority must be one of: ${allowed.join(', ')}` }],
  };
}

export async function createGoal(req, res, next) {
  try {
    const parsed = createGoalSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Validation failed', details: parsed.error.issues });
    }

    const priorityError = await checkPriorityAllowed(req.tenantId, parsed.data.priority);
    if (priorityError) return res.status(400).json(priorityError);

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

      if (!isElevated) {
        if (req.user.role === 'MANAGER') {
          const isSubordinate = await checkIsSubordinate(req.user.id, targetId, req.tenantId);
          const targetUser = targetUsers.find(u => u.id === targetId);
          const isSameDept = req.user.department && targetUser?.department === req.user.department;
          const hasNoExplicitManager = !targetUser?.managerId;
          if (!isSubordinate && !isSameDept && !hasNoExplicitManager) {
            return res.status(403).json({
              error: `Access forbidden: employee "${targetUser?.name || targetId}" is not in your reporting downline or department`,
            });
          }
        } else {
          return res.status(403).json({
            error: 'Access forbidden: you do not have permission to assign goals to other employees',
          });
        }
      }
    }

    // ── Determine initial status ───────────────────────────────────────────
    // Self-assigned goals always start as DRAFT (existing behaviour preserved).
    // Goals assigned to others by MANAGER or elevated roles (ADMIN/HR/CMD/SUPER_ADMIN)
    // use approvalMode to set the initial status.
    let initialStatus;
    let effectiveApprovalMode = null;

    const selfCreatorIsAuthority = isElevated
      || String(req.user.role || '').toUpperCase() === 'MANAGER';

    if (isSelfAssigned && selfCreatorIsAuthority) {
      // Flow A: a manager or an elevated role setting their own goal. They
      // already hold the authority the approval step exists to apply, and
      // above SUPER_ADMIN there is nobody to approve it, so this stays DRAFT.
      initialStatus = GOAL_STATUS.DRAFT;
    } else if (isSelfAssigned) {
      // Flow A2: an employee proposing their own goal. It needs a manager to
      // agree before it becomes real work — an employee setting and then
      // executing their own objectives with nobody signing off is not how the
      // rest of this workflow behaves. Approval happens at
      // POST /goals/:id/activate-approve, exactly as for a manager-assigned
      // goal, so no second approval path exists to keep in step.
      initialStatus = GOAL_STATUS.PENDING_APPROVAL;
      effectiveApprovalMode = 'MANAGER_APPROVAL';
    } else if (approvalMode === 'AUTO_APPROVE') {
      // Flow C: Elevated role or Manager + AUTO_APPROVE → ACTIVE immediately
      initialStatus = GOAL_STATUS.ACTIVE;
      effectiveApprovalMode = 'AUTO_APPROVE';
    } else {
      // Flow B: Elevated role or Manager + MANAGER_APPROVAL (default) → PENDING_APPROVAL
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
    const parsedQuery = listGoalsQuerySchema.safeParse(req.query);
    if (!parsedQuery.success) {
      return res.status(400).json({ error: 'Validation failed', details: parsedQuery.error.issues });
    }
    const { employeeId, status, financialYear, category, scope, page, limit } = parsedQuery.data;
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

      if (employeeId !== req.user.id) {
        if (!canViewDashboard(req.user.role, targetUser.role)) {
          return res.status(403).json({
            error: `Access forbidden: ${req.user.role} cannot view goals of ${targetUser.role || 'this role'}`,
          });
        }

        if (!isElevated) {
          if (req.user.role === 'MANAGER') {
            const targetRole = String(targetUser.role || '').toUpperCase();
            const higherRoles = ['SUPER_ADMIN', 'ADMIN', 'CMD', 'HR', 'FINANCE', 'DIRECTOR', 'LEADERSHIP', 'OWNER', 'MANAGER'];
            if (higherRoles.includes(targetRole)) {
              return res.status(403).json({
                error: `Access forbidden: managers cannot view boards of peer or higher authority roles (${targetRole})`,
              });
            }

            const isSubordinate = await checkIsSubordinate(req.user.id, employeeId, req.tenantId);
            const isSameDept = req.user.department && targetUser?.department === req.user.department;
            const isCoAssigned = await prisma.goalAssignment.findFirst({
              where: {
                tenantId: req.tenantId,
                employeeId: employeeId,
                goal: {
                  OR: [
                    { employeeId: req.user.id },
                    { createdById: req.user.id },
                    { assignments: { some: { employeeId: req.user.id } } },
                  ],
                },
              },
            });

            if (!isSubordinate && !isSameDept && !isCoAssigned && targetUser?.managerId) {
              return res.status(403).json({ error: 'Access forbidden: user is not in your team' });
            }
          } else {
            return res.status(403).json({ error: 'Access forbidden: employees can only view their own goals' });
          }
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
        // 2. Goals assigned to downline employees (including HR/Admin created goals on them)
        // 3. Goals created by self
        // 4. Goals where manager or subordinates are co-assigned
        // 5. Goals in their department for non-elevated employees
        // 6. Goals awaiting manager review
        const allTenantUsers = await prisma.tenantUser.findMany({
          where: { tenantId: req.tenantId, status: 'ACTIVE', isDeleted: false },
          select: { id: true, managerId: true, department: true, role: true },
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

        const managerOrConditions = [
          { employeeId: { in: allowedUserIds } },
          { assignments: { some: { employeeId: { in: allowedUserIds } } } },
          { createdById: req.user.id },
          { createdBy: req.user.name }, // legacy rows without createdById
          {
            status: {
              in: [
                GOAL_STATUS.PENDING_APPROVAL,
                GOAL_STATUS.PENDING_MANAGER_REVIEW,
                'submitted',
                'PENDING_APPROVAL',
                'PENDING_MANAGER_REVIEW',
              ],
            },
          },
        ];

        // Same-department employees with role EMPLOYEE / STUDENT
        if (req.user.department) {
          const deptUserIds = allTenantUsers
            .filter(u => u.department === req.user.department && ['EMPLOYEE', 'STUDENT'].includes(String(u.role || '').toUpperCase()))
            .map(u => u.id);
          if (deptUserIds.length > 0) {
            managerOrConditions.push({ employeeId: { in: deptUserIds } });
            managerOrConditions.push({ assignments: { some: { employeeId: { in: deptUserIds } } } });
          }
        }

        // If no subordinates mapped yet, allow manager to see non-elevated employees without manager
        if (downlineIds.length === 0) {
          const fallbackUserIds = allTenantUsers
            .filter(u => ['EMPLOYEE', 'STUDENT'].includes(String(u.role || '').toUpperCase()) && !u.managerId)
            .map(u => u.id);
          if (fallbackUserIds.length > 0) {
            managerOrConditions.push({ employeeId: { in: fallbackUserIds } });
            managerOrConditions.push({ assignments: { some: { employeeId: { in: fallbackUserIds } } } });
          }
        }

        where.OR = managerOrConditions;
      } else if (isElevated || req.user.role === 'FINANCE') {
        // HR/Admin/Finance: If employeeId is not specified, default to own
        if (!employeeId) {
          where.OR = [
            { employeeId: req.user.id },
            { assignments: { some: { employeeId: req.user.id } } },
          ];
        } else if (employeeId === 'all') {
          // If caller is HR, ADMIN, or FINANCE, exclude goals belonging exclusively to higher roles
          const allRoles = ['SUPER_ADMIN', 'ADMIN', 'CMD', 'HR', 'FINANCE', 'MANAGER', 'EMPLOYEE'];
          const forbiddenRoles = allRoles.filter((r) => !canViewDashboard(req.user.role, r));
          if (forbiddenRoles.length > 0) {
            where.OR = [
              { employeeId: req.user.id },
              { createdById: req.user.id },
              { assignments: { some: { employeeId: req.user.id } } },
              {
                employee: {
                  role: { notIn: forbiddenRoles },
                },
              },
            ];
          }
        }
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

    // One extra query for the whole page, so a goal board can show every
    // lock state without asking per goal.
    const summaries = await summariseGoals(items.map((g) => g.id));

    res.json({
      items: items.map((g) => ({
        ...g,
        weightSummary: summaries[g.id] || null,
        tasks: (g.tasks || []).map((t) => ({ ...t, timing: taskTiming(t) })),
      })),
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
    const parsedParams = goalIdParamSchema.safeParse(req.params);
    if (!parsedParams.success) {
      return res.status(400).json({ error: 'Invalid goal ID parameter', details: parsedParams.error.issues });
    }
    const { id } = parsedParams.data;

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

    // The weight position, computed here rather than in the browser: the
    // browser's arithmetic is a convenience, this is what the API enforces.
    const weightSummary = await goalWeightSummary(goal.id);

    res.json({
      ...goal,
      weightSummary,
      tasks: (goal.tasks || []).map((t) => ({ ...t, timing: taskTiming(t) })),
    });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /goals/:id/weight-summary
 *
 * What the task weights on this goal total, whether execution is unlocked and,
 * when it is not, what has to change. Same access rule as reading the goal.
 */
export async function getGoalWeightSummary(req, res, next) {
  try {
    const parsedParams = goalIdParamSchema.safeParse(req.params);
    if (!parsedParams.success) {
      return res.status(400).json({ error: 'Invalid goal ID parameter', details: parsedParams.error.issues });
    }
    const { id } = parsedParams.data;

    const goal = await prisma.goal.findFirst({
      where: { id, tenantId: req.tenantId },
      include: { assignments: { select: { employeeId: true } } },
    });
    if (!goal) return res.status(404).json({ error: 'Goal not found' });

    const canAccess = await goalService.canAccessGoal(goal, req.user, req.tenantId);
    if (!canAccess) {
      return res.status(403).json({ error: 'Access forbidden: you do not have permission to view this goal' });
    }

    res.json(await goalWeightSummary(id));
  } catch (err) {
    next(err);
  }
}

/**
 * PATCH /goals/:id
 */
export async function updateGoal(req, res, next) {
  try {
    const parsedParams = goalIdParamSchema.safeParse(req.params);
    if (!parsedParams.success) {
      return res.status(400).json({ error: 'Invalid goal ID parameter', details: parsedParams.error.issues });
    }
    const { id } = parsedParams.data;
    const parsed = updateGoalSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Validation failed', details: parsed.error.issues });
    }

    const priorityError = await checkPriorityAllowed(req.tenantId, parsed.data.priority);
    if (priorityError) return res.status(400).json(priorityError);

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
    const { status: _ignoredStatus, addEmployeeIds, ...safeData } = parsed.data;

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

    // ── Add new assignees (elevated roles only) ─────────────────────────────
    if (addEmployeeIds && addEmployeeIds.length > 0) {
      const callerRole = String(req.user.role || '').toUpperCase();
      const callerIsElevated = hasRole(req.user.role, ELEVATED_ROLES);
      const callerIsManager = callerRole === 'MANAGER';

      // A line manager can put people on a goal they oversee. Restricting this
      // to HR/Admin meant a manager who had just approved a goal could not add
      // themselves or a colleague to it, which is the ordinary case, not an
      // administrative one.
      if (!callerIsElevated && !callerIsManager) {
        return res.status(403).json({ error: 'Only a manager, HR or Admin can add assignees to an existing goal.' });
      }

      // Determine which employees are not already assigned
      const existingAssigneeIds = new Set(
        existing.assignments.map((a) => a.employeeId)
      );
      if (existing.employeeId) existingAssigneeIds.add(existing.employeeId);

      const newIds = addEmployeeIds.filter((empId) => !existingAssigneeIds.has(empId));

      if (newIds.length > 0) {
        // Validate that all supplied IDs belong to this tenant
        const validUsers = await prisma.tenantUser.findMany({
          where: { id: { in: newIds }, tenantId: req.tenantId, isDeleted: false },
          select: { id: true, name: true, role: true },
        });

        // HR can only add non-super-elevated users.
        // ADMIN / SUPER_ADMIN can add anyone.
        const callerIsAdmin = hasRole(req.user.role, ['SUPER_ADMIN', 'ADMIN']);
        const filteredUsers = callerIsAdmin
          ? validUsers
          : validUsers.filter((u) => !hasRole(u.role, SUPER_ELEVATED_ROLES));

        const blockedUsers = validUsers.filter((u) => !filteredUsers.some((f) => f.id === u.id));
        if (blockedUsers.length > 0) {
          const blockedNames = blockedUsers.map((u) => `${u.name} (${u.role})`).join(', ');
          return res.status(403).json({
            error: `Only SUPER_ADMIN or ADMIN can assign goals to: ${blockedNames}.`,
          });
        }

        // A manager's reach is their own line, the same rule goal CREATION
        // applies — reusing it rather than inventing a second one that could
        // drift. Adding THEMSELVES is always allowed: a manager co-owning a
        // goal they supervise is the case this whole fix exists for.
        if (callerIsManager && !callerIsElevated) {
          const caller = await prisma.tenantUser.findUnique({
            where: { id: req.user.id }, select: { department: true },
          });
          for (const u of filteredUsers) {
            if (u.id === req.user.id) continue;
            if (hasRole(u.role, MANAGER_OR_ELEVATED_ROLES)) {
              return res.status(403).json({
                error: `Managers cannot assign goals to peer or higher authority roles: ${u.name} (${u.role}).`,
              });
            }
            const target = await prisma.tenantUser.findUnique({
              where: { id: u.id }, select: { department: true, managerId: true },
            });
            const isSubordinate = await checkIsSubordinate(req.user.id, u.id, req.tenantId);
            const isSameDept = caller?.department && target?.department === caller.department;
            const hasNoExplicitManager = !target?.managerId;
            if (!isSubordinate && !isSameDept && !hasNoExplicitManager) {
              return res.status(403).json({
                error: `Access forbidden: "${u.name}" is not in your reporting downline or department.`,
              });
            }
          }
        }

        // An id that matched nobody in this tenant used to be dropped in
        // silence, so the caller got a 200 and an unchanged goal. Say so
        // instead — a request that did nothing should not look like success.
        const unresolved = newIds.filter((empId) => !validUsers.some((u) => u.id === empId));
        if (unresolved.length > 0) {
          return res.status(400).json({
            error: `These users are not in your organisation: ${unresolved.join(', ')}`,
            unresolvedEmployeeIds: unresolved,
          });
        }

        const validIds = filteredUsers.map((u) => u.id);

        // Upsert new GoalAssignment rows
        await Promise.all(
          validIds.map((empId) =>
            prisma.goalAssignment.upsert({
              where: { goalId_employeeId: { goalId: id, employeeId: empId } },
              update: {},   // already exists — leave untouched
              create: {
                tenantId: req.tenantId,
                goalId: id,
                employeeId: empId,
                assignedById: req.user.id,
                progress: 0,
                status: existing.status,
                milestones: 0,
                completedMilestones: 0,
              },
            })
          )
        );

        const addedNames = validUsers.map((u) => u.name).join(', ');
        await goalService.logAudit({
          goalId: id,
          performedById: req.user.id,
          action: 'GOAL_UPDATED',
          details: `${req.user.name} added new assignee(s) to the goal: ${addedNames}.`,
        });

        // Notify newly added employees
        for (const user of validUsers) {
          if (user.id === req.user.id) continue;
          await goalService.notify({
            tenantId: req.tenantId,
            recipientId: user.id,
            type: 'goal_update',
            title: `Goal Assigned: "${updated.title}"`,
            body: `${req.user.name} has assigned you to the goal "${updated.title}".`,
            entityType: 'goal',
            entityId: id,
          });
        }
      }
    }

    await goalService.logAudit({
      goalId: id,
      performedById: req.user.id,
      action: 'GOAL_UPDATED',
      details: `${req.user.name} updated goal details.`,
    });

    // Re-fetch to return the fully up-to-date goal (including any new assignments)
    const finalGoal = await prisma.goal.findUnique({
      where: { id },
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

    res.json(finalGoal);
  } catch (err) {
    next(err);
  }
}

/**
 * DELETE /goals/:id
 */
export async function deleteGoal(req, res, next) {
  try {
    const parsedParams = goalIdParamSchema.safeParse(req.params);
    if (!parsedParams.success) {
      return res.status(400).json({ error: 'Invalid goal ID parameter', details: parsedParams.error.issues });
    }
    const { id } = parsedParams.data;

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
    const parsedParams = goalIdParamSchema.safeParse(req.params);
    if (!parsedParams.success) {
      return res.status(400).json({ error: 'Invalid goal ID parameter', details: parsedParams.error.issues });
    }
    const { id } = parsedParams.data;
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
    const parsedParams = goalIdParamSchema.safeParse(req.params);
    if (!parsedParams.success) {
      return res.status(400).json({ error: 'Invalid goal ID parameter', details: parsedParams.error.issues });
    }
    const { id } = parsedParams.data;
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
    const parsedParams = goalIdParamSchema.safeParse(req.params);
    if (!parsedParams.success) {
      return res.status(400).json({ error: 'Invalid goal ID parameter', details: parsedParams.error.issues });
    }
    const { id } = parsedParams.data;
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
    const parsedParams = goalIdParamSchema.safeParse(req.params);
    if (!parsedParams.success) {
      return res.status(400).json({ error: 'Invalid goal ID parameter', details: parsedParams.error.issues });
    }
    const { id } = parsedParams.data;
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
    const parsedParams = goalIdParamSchema.safeParse(req.params);
    if (!parsedParams.success) {
      return res.status(400).json({ error: 'Invalid goal ID parameter', details: parsedParams.error.issues });
    }
    const { id } = parsedParams.data;
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
    const parsedParams = goalIdParamSchema.safeParse(req.params);
    if (!parsedParams.success) {
      return res.status(400).json({ error: 'Invalid goal ID parameter', details: parsedParams.error.issues });
    }
    const { id } = parsedParams.data;
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
    const parsedParams = goalIdParamSchema.safeParse(req.params);
    if (!parsedParams.success) {
      return res.status(400).json({ error: 'Invalid goal ID parameter', details: parsedParams.error.issues });
    }
    const { id } = parsedParams.data;
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

