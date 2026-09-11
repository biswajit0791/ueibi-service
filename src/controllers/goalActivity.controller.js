import { prisma } from '../lib/prisma.js';
import { goalCommentSchema } from '../validations/goal.schema.js';
import { logTaskAudit, pushNotification } from './taskActivity.controller.js';
import { goalService } from '../services/goal.service.js';
import { HR_ROLES, hasRole } from '../lib/roles.js';

// ─── Helper: write a goal audit log entry ──────────────────────────────────
async function logGoalAudit({ goalId, performedById, action, details, previousValue }) {
  return prisma.goalAuditLog.create({
    data: { goalId, performedById, action, details: details || null, previousValue: previousValue || undefined },
  });
}

// ─── Helper: load a tenant-scoped goal and assert the caller may see it ─────
async function loadAccessibleGoal(goalId, req) {
  const goal = await prisma.goal.findFirst({
    where: { id: goalId, tenantId: req.tenantId },
    include: { assignments: { select: { employeeId: true } } },
  });
  if (!goal) {
    throw { status: 404, message: 'Goal not found' };
  }
  const allowed = await goalService.canAccessGoal(goal, req.user, req.tenantId);
  if (!allowed) {
    throw { status: 403, message: 'Access forbidden: you do not have permission to view this goal' };
  }
  return goal;
}

// ─── POST /api/goals/:id/comments ───────────────────────────────────────────
export async function addGoalComment(req, res, next) {
  try {
    const { id: goalId } = req.params;
    const parsed = goalCommentSchema.safeParse(req.body || {});
    if (!parsed.success) {
      return res.status(400).json({ error: 'Validation failed', details: parsed.error.issues });
    }
    const { comment, attachments } = parsed.data;

    let goal;
    try {
      goal = await loadAccessibleGoal(goalId, req);
    } catch (e) {
      return res.status(e.status || 500).json({ error: e.message });
    }
    const isOwner = goal.employeeId === req.user.id
      || goal.assignments.some((a) => a.employeeId === req.user.id);

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
        tenantId: req.tenantId,
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

    try {
      await loadAccessibleGoal(goalId, req);
    } catch (e) {
      return res.status(e.status || 500).json({ error: e.message });
    }

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

    try {
      await loadAccessibleGoal(goalId, req);
    } catch (e) {
      return res.status(e.status || 500).json({ error: e.message });
    }

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
    const { id: goalId, cid } = req.params;

    // Verify comment belongs to the goal and goal belongs to requester's tenant
    const comment = await prisma.goalComment.findUnique({
      where: { id: cid },
      include: { goal: true },
    });
    if (!comment || comment.goalId !== goalId || comment.goal.tenantId !== req.tenantId) {
      return res.status(404).json({ error: 'Comment not found' });
    }

    if (comment.authorId !== req.user.id && !hasRole(req.user.role, HR_ROLES)) {
      return res.status(403).json({ error: 'Access forbidden' });
    }

    await prisma.goalComment.delete({ where: { id: cid } });
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
}
