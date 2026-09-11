import { prisma } from '../lib/prisma.js';
import { emitToUser } from '../lib/socket.js';
import { commentService } from '../services/comment.service.js';
import { storageService } from '../services/storage/storage.service.js';
import { createTaskCommentSchema } from '../validations/task.schema.js';
import { loadTaskForUser } from '../services/taskAccess.service.js';

// ─── Helper: write an audit log entry ──────────────────────────────────────
export async function logTaskAudit({ taskId, performedById, action, details, previousValue }) {
  return prisma.taskAuditLog.create({
    data: { taskId, performedById, action, details: details || null, previousValue: previousValue || undefined },
  });
}

// ─── Helper: create & push a notification ──────────────────────────────────
export async function pushNotification({ tenantId, recipientId, type, title, body, entityType, entityId }) {
  if (!recipientId || recipientId === 'system' || !tenantId) return null;
  const notif = await prisma.notification.create({
    data: { tenantId, recipientId, type, title, body: body || null, entityType: entityType || null, entityId: entityId || null },
  });
  // Real-time push via Socket.IO
  emitToUser(tenantId, recipientId, 'notification', notif);
  return notif;
}

// ─── Helper: verify task access for requester ──────────────────────────────
// Delegates to the shared taskAccess service so comments/audit enforce the same
// rule as task edits.
const verifyTaskAccess = (taskId, requestingUser, tenantId) => loadTaskForUser(taskId, requestingUser, tenantId);

// ─── POST /api/tasks/:id/comments ───────────────────────────────────────────
export async function addTaskComment(req, res, next) {
  try {
    const { id: taskId } = req.params;
    const validated = createTaskCommentSchema.safeParse(req.body);
    if (!validated.success) {
      return res.status(400).json({ error: validated.error.errors[0]?.message || 'Invalid comment data' });
    }

    const commentText = (validated.data.comment || req.body.comment || req.body.content || '').trim();
    const file = req.file || null;

    if (!commentText && !file) {
      return res.status(400).json({ error: 'Comment text or file attachment is required' });
    }

    // Verify task exists within requester's tenant & check permissions
    const task = await verifyTaskAccess(taskId, req.user, req.tenantId);

    const newComment = await commentService.createComment({
      tenantId: req.tenantId,
      taskId,
      authorId: req.user.id,
      commentText,
      file,
    });

    // Audit log entry
    const detailsSnippet = commentText ? commentText.trim().slice(0, 80) : (file ? `Attached file ${file.originalname}` : 'Posted comment');
    await logTaskAudit({
      taskId,
      performedById: req.user.id,
      action: 'progress_update',
      details: `${req.user.name} added progress update: "${detailsSnippet}"`,
    });

    // Notify task owner if commenter is someone else (manager/HR feedback)
    if (task.employeeId !== req.user.id) {
      await pushNotification({
        tenantId: req.tenantId,
        recipientId: task.employeeId,
        type: 'task_update',
        title: 'New feedback on your task',
        body: `${req.user.name} commented: "${detailsSnippet.slice(0, 100)}"`,
        entityType: 'task',
        entityId: taskId,
      });
    }

    res.status(201).json(newComment);
  } catch (err) {
    if (err.status) {
      return res.status(err.status).json({ error: err.message });
    }
    next(err);
  }
}

// ─── GET /api/tasks/:id/comments ────────────────────────────────────────────
export async function listTaskComments(req, res, next) {
  try {
    const { id: taskId } = req.params;
    const { page, limit } = req.query;

    // Verify task belongs to current tenant and user has access
    await verifyTaskAccess(taskId, req.user, req.tenantId);

    const result = await commentService.listComments({
      tenantId: req.tenantId,
      taskId,
      page,
      limit,
    });

    res.json(result);
  } catch (err) {
    if (err.status) {
      return res.status(err.status).json({ error: err.message });
    }
    next(err);
  }
}

// ─── GET /api/tasks/:id/comments/:cid/attachments/:aid ──────────────────────
export async function getTaskCommentAttachment(req, res, next) {
  try {
    const { id: taskId, cid, aid } = req.params;

    // Verify task belongs to current tenant and user has access
    await verifyTaskAccess(taskId, req.user, req.tenantId);

    const attachment = await commentService.getAttachment({
      tenantId: req.tenantId,
      taskId,
      commentId: cid,
      attachmentId: aid,
    });

    const stream = await storageService.getDownloadStream(attachment.storageKey);

    const isDownload = req.query.download === 'true';
    const dispositionType = isDownload ? 'attachment' : 'inline';
    const encodedFilename = encodeURIComponent(attachment.originalName);

    res.setHeader('Content-Type', attachment.mimeType || 'application/octet-stream');
    res.setHeader('Content-Disposition', `${dispositionType}; filename="${encodedFilename}"; filename*=UTF-8''${encodedFilename}`);
    if (attachment.size) {
      res.setHeader('Content-Length', attachment.size);
    }

    stream.pipe(res);
  } catch (err) {
    if (err.status) {
      return res.status(err.status).json({ error: err.message });
    }
    next(err);
  }
}

// ─── DELETE /api/tasks/:id/comments/:cid ────────────────────────────────────
export async function deleteTaskComment(req, res, next) {
  try {
    const { id: taskId, cid } = req.params;

    // Verify task belongs to current tenant
    await verifyTaskAccess(taskId, req.user, req.tenantId);

    const result = await commentService.deleteComment({
      tenantId: req.tenantId,
      taskId,
      commentId: cid,
      requestingUser: req.user,
    });

    res.json(result);
  } catch (err) {
    if (err.status) {
      return res.status(err.status).json({ error: err.message });
    }
    next(err);
  }
}

// ─── DELETE /api/tasks/:id/comments/:cid/attachments/:aid ───────────────────
export async function deleteTaskCommentAttachment(req, res, next) {
  try {
    const { id: taskId, cid, aid } = req.params;

    // Verify task belongs to current tenant
    await verifyTaskAccess(taskId, req.user, req.tenantId);

    const result = await commentService.deleteAttachment({
      tenantId: req.tenantId,
      taskId,
      commentId: cid,
      attachmentId: aid,
      requestingUser: req.user,
    });

    res.json(result);
  } catch (err) {
    if (err.status) {
      return res.status(err.status).json({ error: err.message });
    }
    next(err);
  }
}

// ─── GET /api/tasks/:id/audit ────────────────────────────────────────────────
export async function listTaskAudit(req, res, next) {
  try {
    const { id: taskId } = req.params;

    // Verify task belongs to current tenant and user has access
    await verifyTaskAccess(taskId, req.user, req.tenantId);

    const items = await prisma.taskAuditLog.findMany({
      where: { taskId },
      include: {
        performedBy: { select: { id: true, name: true, role: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    res.json({ items });
  } catch (err) {
    if (err.status) {
      return res.status(err.status).json({ error: err.message });
    }
    next(err);
  }
}


