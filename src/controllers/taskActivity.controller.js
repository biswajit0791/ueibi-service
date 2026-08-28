import { prisma } from '../lib/prisma.js';
import { emitToUser } from '../lib/socket.js';

// ─── Helper: write an audit log entry ──────────────────────────────────────
export async function logTaskAudit({ taskId, performedById, action, details, previousValue }) {
  return prisma.taskAuditLog.create({
    data: { taskId, performedById, action, details: details || null, previousValue: previousValue || undefined },
  });
}

// ─── Helper: create & push a notification ──────────────────────────────────
export async function pushNotification({ tenantId, recipientId, type, title, body, entityType, entityId }) {
  if (!recipientId || recipientId === 'system') return null;
  const notif = await prisma.notification.create({
    data: { tenantId, recipientId, type, title, body: body || null, entityType: entityType || null, entityId: entityId || null },
  });
  // Real-time push via Socket.IO
  emitToUser(tenantId, recipientId, 'notification', notif);
  return notif;
}

// ─── POST /api/tasks/:id/comments ───────────────────────────────────────────
export async function addTaskComment(req, res, next) {
  try {
    const { id: taskId } = req.params;
    const { comment, attachments } = req.body || {};

    if (!comment?.trim()) {
      return res.status(400).json({ error: 'Comment text is required' });
    }

    const task = await prisma.task.findUnique({ where: { id: taskId } });
    if (!task) return res.status(404).json({ error: 'Task not found' });

    // Any tenant member can comment on a task they can see (own or subordinate)
    const isOwner = task.employeeId === req.user.id;
    const allowedRoles = ['SUPER_ADMIN', 'HR', 'ADMIN'];
    if (!isOwner && !allowedRoles.includes(req.user.role)) {
      const isSubordinate = await prisma.tenantUser.findFirst({
        where: { id: task.employeeId, managerId: req.user.id },
      });
      if (!isSubordinate) return res.status(403).json({ error: 'Access forbidden' });
    }

    const newComment = await prisma.taskComment.create({
      data: {
        taskId,
        authorId: req.user.id,
        comment: comment.trim(),
        attachments: attachments || [],
      },
      include: {
        author: { select: { id: true, name: true, role: true, designation: true } },
      },
    });

    // Audit log entry
    await logTaskAudit({
      taskId,
      performedById: req.user.id,
      action: 'progress_update',
      details: `${req.user.name} added progress update: "${comment.trim().slice(0, 80)}"`,
    });

    // Notify task owner if commenter is someone else (manager/HR feedback)
    if (!isOwner) {
      await pushNotification({
        tenantId: req.user.tenantId,
        recipientId: task.employeeId,
        type: 'task_update',
        title: 'New feedback on your task',
        body: `${req.user.name} commented: "${comment.trim().slice(0, 100)}"`,
        entityType: 'task',
        entityId: taskId,
      });
    }

    res.status(201).json(newComment);
  } catch (err) {
    next(err);
  }
}

// ─── GET /api/tasks/:id/comments ────────────────────────────────────────────
export async function listTaskComments(req, res, next) {
  try {
    const { id: taskId } = req.params;

    const task = await prisma.task.findUnique({ where: { id: taskId } });
    if (!task) return res.status(404).json({ error: 'Task not found' });

    const items = await prisma.taskComment.findMany({
      where: { taskId },
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

// ─── GET /api/tasks/:id/audit ────────────────────────────────────────────────
export async function listTaskAudit(req, res, next) {
  try {
    const { id: taskId } = req.params;

    const task = await prisma.task.findUnique({ where: { id: taskId } });
    if (!task) return res.status(404).json({ error: 'Task not found' });

    const items = await prisma.taskAuditLog.findMany({
      where: { taskId },
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

// ─── DELETE /api/tasks/:id/comments/:cid ────────────────────────────────────
export async function deleteTaskComment(req, res, next) {
  try {
    const { cid } = req.params;

    const comment = await prisma.taskComment.findUnique({ where: { id: cid } });
    if (!comment) return res.status(404).json({ error: 'Comment not found' });

    // Only author or admin/HR can delete
    if (comment.authorId !== req.user.id && !['SUPER_ADMIN', 'HR', 'ADMIN'].includes(req.user.role)) {
      return res.status(403).json({ error: 'Access forbidden' });
    }

    await prisma.taskComment.delete({ where: { id: cid } });
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
}
