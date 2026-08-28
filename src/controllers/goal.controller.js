import { prisma } from '../lib/prisma.js';

export async function createGoal(req, res, next) {
  try {
    const { title, category, priority, dueDate, employeeId } = req.body || {};
    if (!title) {
      return res.status(400).json({ error: 'Goal title is required' });
    }

    const goal = await prisma.goal.create({
      data: {
        title,
        category,
        priority,
        dueDate: dueDate ? new Date(dueDate) : undefined,
        employeeId: employeeId || req.user.id,
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

    // Verify requesting user is either the employee, their manager, or HR
    if (employeeId !== req.user.id && req.user.role !== 'SUPER_ADMIN' && req.user.role !== 'HR') {
      const subordinate = await prisma.tenantUser.findFirst({
        where: { id: employeeId, managerId: req.user.id },
      });
      if (!subordinate) {
        return res.status(403).json({ error: 'Access forbidden: user is not your subordinate' });
      }
    }

    const items = await prisma.goal.findMany({
      where: { employeeId },
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

    const goal = await prisma.goal.findUnique({
      where: { id },
    });

    if (!goal) {
      return res.status(404).json({ error: 'Goal not found' });
    }

    // Verify authorization (only owner, manager, or admin)
    if (goal.employeeId !== req.user.id && req.user.role !== 'SUPER_ADMIN' && req.user.role !== 'HR') {
      const subordinate = await prisma.tenantUser.findFirst({
        where: { id: goal.employeeId, managerId: req.user.id },
      });
      if (!subordinate) {
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
