import { prisma } from '../lib/prisma.js';
import { storageService } from './storage/storage.service.js';
import crypto from 'node:crypto';

export class CommentService {
  /**
   * Helper to parse attachments JSON strings into rich metadata objects.
   */
  parseAttachments(rawAttachments = []) {
    if (!Array.isArray(rawAttachments)) return [];
    return rawAttachments.map((att) => {
      if (typeof att === 'string') {
        try {
          const parsed = JSON.parse(att);
          if (parsed && typeof parsed === 'object') return parsed;
        } catch {
          // Fallback if plain path was stored
          const basename = att.split(/[/\\]/).pop() || att;
          return {
            id: att,
            originalName: basename,
            storedName: basename,
            mimeType: 'application/octet-stream',
            size: 0,
            storageKey: att,
            storageProvider: 'LOCAL',
            createdAt: new Date().toISOString(),
          };
        }
      }
      return att;
    });
  }

  /**
   * Creates a new task comment with optional file attachment.
   * Cleans up physical file if database insertion fails.
   */
  async createComment({ tenantId, taskId, authorId, commentText, file }) {
    if (!commentText?.trim() && !file) {
      throw { status: 400, message: 'Comment content or attachment is required' };
    }

    let savedFileMeta = null;

    // 1. Process physical file upload through StorageService if present
    if (file) {
      savedFileMeta = await storageService.save({
        tenantId,
        taskId,
        buffer: file.buffer,
        originalName: file.originalname,
        mimeType: file.mimetype,
        size: file.size,
      });

      // Add unique identifier to attachment metadata
      savedFileMeta.id = `att_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
      savedFileMeta.createdAt = new Date().toISOString();
    }

    try {
      const attachmentsPayload = savedFileMeta ? [JSON.stringify(savedFileMeta)] : [];

      const created = await prisma.taskComment.create({
        data: {
          taskId,
          authorId,
          comment: (commentText || '').trim(),
          attachments: attachmentsPayload,
        },
        include: {
          author: { select: { id: true, name: true, role: true, designation: true } },
        },
      });

      return {
        ...created,
        attachments: this.parseAttachments(created.attachments),
      };
    } catch (dbErr) {
      // 2. Database failed: Clean up uploaded physical file to prevent orphans
      if (savedFileMeta?.storageKey) {
        await storageService.delete(savedFileMeta.storageKey).catch(() => {});
      }
      throw dbErr;
    }
  }

  /**
   * Lists task comments with pagination and rich attachment metadata.
   */
  async listComments({ tenantId, taskId, page = 1, limit = 20 }) {
    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));
    const skip = (pageNum - 1) * limitNum;

    const [items, total] = await Promise.all([
      prisma.taskComment.findMany({
        where: { taskId },
        include: {
          author: { select: { id: true, name: true, role: true, designation: true } },
        },
        orderBy: { createdAt: 'asc' },
        skip,
        take: limitNum,
      }),
      prisma.taskComment.count({ where: { taskId } }),
    ]);

    const formattedItems = items.map((item) => ({
      ...item,
      attachments: this.parseAttachments(item.attachments),
    }));

    return {
      items: formattedItems,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        pages: Math.ceil(total / limitNum) || 1,
      },
    };
  }

  /**
   * Retrieves single attachment record from a comment.
   */
  async getAttachment({ tenantId, taskId, commentId, attachmentId }) {
    const comment = await prisma.taskComment.findFirst({
      where: { id: commentId, taskId },
      include: { task: true },
    });

    if (!comment || comment.task?.tenantId !== tenantId) {
      throw { status: 404, message: 'Comment not found or access denied' };
    }

    const attachments = this.parseAttachments(comment.attachments);
    const attachment = attachments.find(
      (a) => a.id === attachmentId || a.storedName === attachmentId || a.storageKey === attachmentId
    );

    if (!attachment) {
      throw { status: 404, message: 'Attachment not found' };
    }

    return attachment;
  }

  /**
   * Deletes a comment and all its physical attachments.
   */
  async deleteComment({ tenantId, taskId, commentId, requestingUser }) {
    const comment = await prisma.taskComment.findFirst({
      where: { id: commentId, taskId },
      include: {
        task: true,
      },
    });

    if (!comment || comment.task?.tenantId !== tenantId) {
      throw { status: 404, message: 'Comment not found' };
    }

    const isAuthor = comment.authorId === requestingUser.id;
    const isElevated = ['SUPER_ADMIN', 'ADMIN', 'HR'].includes(requestingUser.role);

    if (!isAuthor && !isElevated) {
      throw { status: 403, message: 'Access forbidden: you cannot delete this comment' };
    }

    // Delete all physical files from storage
    const attachments = this.parseAttachments(comment.attachments);
    if (attachments.length > 0) {
      await Promise.all(
        attachments.map((att) => (att.storageKey ? storageService.delete(att.storageKey).catch(() => {}) : Promise.resolve()))
      );
    }

    await prisma.taskComment.delete({ where: { id: commentId } });
    return { success: true };
  }

  /**
   * Deletes a single attachment from a comment.
   */
  async deleteAttachment({ tenantId, taskId, commentId, attachmentId, requestingUser }) {
    const comment = await prisma.taskComment.findFirst({
      where: { id: commentId, taskId },
      include: { task: true },
    });

    if (!comment || comment.task?.tenantId !== tenantId) {
      throw { status: 404, message: 'Comment not found' };
    }

    const isAuthor = comment.authorId === requestingUser.id;
    const isElevated = ['SUPER_ADMIN', 'ADMIN', 'HR'].includes(requestingUser.role);

    if (!isAuthor && !isElevated) {
      throw { status: 403, message: 'Access forbidden: you cannot delete this attachment' };
    }

    const attachments = this.parseAttachments(comment.attachments);
    const targetAtt = attachments.find(
      (a) => a.id === attachmentId || a.storedName === attachmentId || a.storageKey === attachmentId
    );

    if (!targetAtt) {
      throw { status: 404, message: 'Attachment not found' };
    }

    if (targetAtt.storageKey) {
      await storageService.delete(targetAtt.storageKey).catch(() => {});
    }

    const updatedAttachments = attachments
      .filter((a) => a !== targetAtt)
      .map((a) => JSON.stringify(a));

    await prisma.taskComment.update({
      where: { id: commentId },
      data: { attachments: updatedAttachments },
    });

    return { success: true };
  }
}

export const commentService = new CommentService();
