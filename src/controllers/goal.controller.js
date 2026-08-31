import { prisma } from '../lib/prisma.js';
import { createGoalSchema } from '../validations/goal.schema.js';

/**
 * Traverses up the reporting chain from targetId to see if managerId is encountered.
 */
async function checkIsSubordinate(managerId, targetId, tenantId) {
  if (managerId === targetId) return true;
  let current = await prisma.tenantUser.findFirst({
    where: { id: targetId, tenantId },
  });
  while (current && current.managerId) {
    if (current.managerId === managerId) {
      return true;
    }
    current = await prisma.tenantUser.findFirst({
      where: { id: current.managerId, tenantId },
    });
  }
  return false;
}

export async function getAssignableUsers(req, res, next) {
  try {
    const role = req.user.role;
    const tenantId = req.tenantId;

    if (role === 'SUPER_ADMIN' || role === 'ADMIN' || role === 'HR') {
      const users = await prisma.tenantUser.findMany({
        where: { tenantId, status: 'ACTIVE' },
        select: {
          id: true,
          name: true,
          email: true,
          role: true,
          department: true,
          designation: true,
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
      const allowedRoles = ['SUPER_ADMIN', 'ADMIN', 'HR', 'MANAGER'];
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
        title,
        description,
        category,
        goalType: goalType || 'General',
        priority,
        financialYear,
        quarter,
        startDate: startDate ? new Date(startDate) : undefined,
        targetDate: targetDate ? new Date(targetDate) : undefined,
        attachments: attachments || [],
        specialNotes,
        employeeId: targetEmployeeId,
        createdBy: req.user.name,
      },
    });

    res.status(201).json(goal);
  } catch (err) {
    next(err);
  }
}

export async function listGoals(req, res, next) {
  try {
    const employeeId = req.query.employeeId || req.user.id;

    // Verify tenant isolation
    const targetUser = await prisma.tenantUser.findFirst({
      where: { id: employeeId, tenantId: req.tenantId },
    });
    if (!targetUser) {
      return res.status(400).json({ error: 'Target employee not found in this organization' });
    }

    // Verify authorization
    if (employeeId !== req.user.id && req.user.role !== 'SUPER_ADMIN' && req.user.role !== 'HR') {
      const isSubordinate = await checkIsSubordinate(req.user.id, employeeId, req.tenantId);
      if (!isSubordinate) {
        return res.status(403).json({ error: 'Access forbidden: user is not your subordinate' });
      }
    }

    const items = await prisma.goal.findMany({
      where: { employeeId, tenantId: req.tenantId },
      include: { tasks: true },
      orderBy: { createdAt: 'desc' },
    });

    res.json({ items });
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

    // Verify authorization (only owner, manager, or admin/HR)
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
