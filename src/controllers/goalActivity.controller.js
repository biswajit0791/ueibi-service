import { prisma } from '../lib/prisma.js';
import { logTaskAudit, pushNotification } from './taskActivity.controller.js';

// ─── Helper: write a goal audit log entry ──────────────────────────────────
async function logGoalAudit({ goalId, performedById, action, details, previousValue }) {
  return prisma.goalAuditLog.create({
    data: { goalId, performedById, action, details: details || null, previousValue: previousValue || undefined },
  });
}

// ─── POST /api/goals/:id/comments ───────────────────────────────────────────
export async function addGoalComment(req, res, next) {
  try {
    const { id: goalId } = req.params;
    const { comment, attachments } = req.body || {};

    if (!comment?.trim()) {
      return res.status(400).json({ error: 'Comment text is required' });
    }

    const goal = await prisma.goal.findUnique({ where: { id: goalId } });
    if (!goal) return res.status(404).json({ error: 'Goal not found' });

    const isOwner = goal.employeeId === req.user.id;
    const allowedRoles = ['SUPER_ADMIN', 'HR', 'ADMIN'];
    if (!isOwner && !allowedRoles.includes(req.user.role)) {
      const isSubordinate = await prisma.tenantUser.findFirst({
        where: { id: goal.employeeId, managerId: req.user.id },
      });
      if (!isSubordinate) return res.status(403).json({ error: 'Access forbidden' });
    }

    const newComment = await prisma.goalComment.create({
      data: {
        goalId,
        authorId: req.user.id,
        comment: comment.trim(),
        attachments: attachments || [],
      },
      include: {
        author: { select: { id: true, name: true, role: true, designation: true } },
      },
    });

    await logGoalAudit({
      goalId,
      performedById: req.user.id,
      action: 'progress_update',
      details: `${req.user.name} added progress update: "${comment.trim().slice(0, 80)}"`,
    });

    if (!isOwner) {
      await pushNotification({
        tenantId: req.user.tenantId,
        recipientId: goal.employeeId,
        type: 'goal_update',
        title: 'New feedback on your goal',
        body: `${req.user.name} commented: "${comment.trim().slice(0, 100)}"`,
        entityType: 'goal',
        entityId: goalId,
      });
    }

    res.status(201).json(newComment);
  } catch (err) {
    next(err);
  }
}

// ─── GET /api/goals/:id/comments ────────────────────────────────────────────
export async function listGoalComments(req, res, next) {
  try {
    const { id: goalId } = req.params;

    const goal = await prisma.goal.findUnique({ where: { id: goalId } });
    if (!goal) return res.status(404).json({ error: 'Goal not found' });

    const items = await prisma.goalComment.findMany({
      where: { goalId },
      include: {
        author: { select: { id: true, name: true, role: true, designation: true } },
      },
      orderBy: { createdAt: 'asc' },
    });

    res.json({ items });
  } catch (err) {
    next(err);
  }
}

// ─── GET /api/goals/:id/audit ────────────────────────────────────────────────
export async function listGoalAudit(req, res, next) {
  try {
    const { id: goalId } = req.params;

    const items = await prisma.goalAuditLog.findMany({
      where: { goalId },
      include: {
        performedBy: { select: { id: true, name: true, role: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    res.json({ items });
  } catch (err) {
    next(err);
  }
}

// ─── DELETE /api/goals/:id/comments/:cid ────────────────────────────────────
export async function deleteGoalComment(req, res, next) {
  try {
    const { cid } = req.params;

    const comment = await prisma.goalComment.findUnique({ where: { id: cid } });
    if (!comment) return res.status(404).json({ error: 'Comment not found' });

    if (comment.authorId !== req.user.id && !['SUPER_ADMIN', 'HR', 'ADMIN'].includes(req.user.role)) {
      return res.status(403).json({ error: 'Access forbidden' });
    }

    await prisma.goalComment.delete({ where: { id: cid } });
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
}
