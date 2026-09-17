import { prisma } from '../lib/prisma.js';

// PostgreSQL is the source of truth for chat. Every method here is tenant- and
// conversation-scoped; nothing in this file will read or mutate a row outside
// the caller's tenant.
export class MessageRepository {
  async create(data) {
    return prisma.message.create({
      data: {
        tenantId: data.tenantId,
        conversationId: data.conversationId,
        senderId: data.senderId,
        receiverId: data.receiverId ?? null,
        text: data.text ?? '',
        mediaUrl: data.mediaUrl ?? null,
        mediaType: data.mediaType ?? null,
        fileName: data.fileName ?? null,
        fileSize: data.fileSize ?? null,
        createdAt: data.createdAt ?? new Date(),
      },
    });
  }

  async findConversation({ tenantId, conversationId, userId, limit = 100, before }) {
    const messages = await prisma.message.findMany({
      where: {
        tenantId,
        conversationId,
        NOT: { deletedFor: { has: userId } },
        ...(before ? { createdAt: { lt: new Date(before) } } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: Math.min(Number(limit) || 100, 200),
    });
    return messages.reverse();
  }

  async findById(id, tenantId) {
    return prisma.message.findFirst({ where: { id, tenantId } });
  }

  async deleteForUser({ messageId, tenantId, userId }) {
    const msg = await this.findById(messageId, tenantId);
    if (!msg) return null;

    const current = Array.isArray(msg.deletedFor) ? msg.deletedFor : [];
    if (current.includes(userId)) return msg;

    return prisma.message.update({
      where: { id: messageId },
      data: { deletedFor: [...current, userId] },
    });
  }

  async deleteForEveryone({ messageId, tenantId }) {
    return prisma.message.update({
      where: { id: messageId },
      data: {
        isDeleted: true,
        text: 'This message was deleted',
        mediaUrl: null,
        mediaType: null,
        fileName: null,
        fileSize: null,
      },
    });
  }

  // "Clear chat" hides the conversation for the requesting user only — it never
  // destroys the other participant's copy, and never deletes rows.
  async clearConversationForUser({ tenantId, conversationId, userId }) {
    const messages = await prisma.message.findMany({
      where: { tenantId, conversationId, NOT: { deletedFor: { has: userId } } },
      select: { id: true, deletedFor: true },
    });

    if (messages.length === 0) return 0;

    await prisma.$transaction(
      messages.map((m) =>
        prisma.message.update({
          where: { id: m.id },
          data: { deletedFor: [...(m.deletedFor || []), userId] },
        })
      )
    );
    return messages.length;
  }

  async markConversationRead({ tenantId, conversationId, readerId, readAt }) {
    const result = await prisma.message.updateMany({
      where: { tenantId, conversationId, receiverId: readerId, status: { not: 'READ' } },
      data: { status: 'READ', readAt: readAt ?? new Date() },
    });
    return result.count;
  }

  async markDelivered({ tenantId, conversationId, receiverId, deliveredAt }) {
    const pending = await prisma.message.findMany({
      where: { tenantId, conversationId, receiverId, status: 'SENT' },
      select: { id: true },
    });
    if (pending.length === 0) return [];

    await prisma.message.updateMany({
      where: { id: { in: pending.map((p) => p.id) } },
      data: { status: 'DELIVERED', deliveredAt: deliveredAt ?? new Date() },
    });
    return pending.map((p) => p.id);
  }

  // PostgreSQL fallback for the inbox list. Grouping happens in JS because the
  // "latest row per conversation" shape is awkward in Prisma's groupBy.
  async findConversationList({ tenantId, userId, limit = 200 }) {
    const rows = await prisma.message.findMany({
      where: {
        tenantId,
        OR: [{ senderId: userId }, { receiverId: userId }],
        NOT: { deletedFor: { has: userId } },
      },
      orderBy: { createdAt: 'desc' },
      take: 2000,
    });

    const byConversation = new Map();
    for (const row of rows) {
      let entry = byConversation.get(row.conversationId);
      if (!entry) {
        // rows are newest-first, so the first one seen is the latest.
        entry = { conversationId: row.conversationId, unread: 0, last: row };
        byConversation.set(row.conversationId, entry);
      }
      if (row.receiverId === userId && row.status !== 'READ' && !row.isDeleted) {
        entry.unread += 1;
      }
    }

    return [...byConversation.values()]
      .sort((a, b) => b.last.createdAt - a.last.createdAt)
      .slice(0, Math.min(Number(limit) || 200, 500));
  }

  async countUnread({ tenantId, userId }) {
    return prisma.message.groupBy({
      by: ['conversationId'],
      where: {
        tenantId,
        receiverId: userId,
        status: { not: 'READ' },
        isDeleted: false,
        NOT: { deletedFor: { has: userId } },
      },
      _count: { _all: true },
      _max: { createdAt: true },
    });
  }
}

export default new MessageRepository();
