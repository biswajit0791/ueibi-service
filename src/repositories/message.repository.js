import { prisma } from '../lib/prisma.js';

export class MessageRepository {
  async create(data) {
    return prisma.message.create({
      data: {
        id: data.id,
        senderId: data.senderId,
        text: data.text,
        mediaUrl: data.mediaUrl ?? null,
        mediaType: data.mediaType ?? null,
        fileName: data.fileName ?? null,
        fileSize: data.fileSize ?? null,
        createdAt: data.createdAt ?? new Date(),
      },
    });
  }

  async findAll(userId) {
    const messages = await prisma.message.findMany({
      orderBy: { createdAt: 'asc' },
    });

    return messages.filter((msg) => {
      if (msg.isDeleted) return false;
      if (userId && Array.isArray(msg.deletedFor) && msg.deletedFor.includes(userId)) return false;
      return true;
    });
  }

  async findById(id) {
    return prisma.message.findUnique({
      where: { id },
    });
  }

  async deleteForUser(messageId, userId) {
    const msg = await this.findById(messageId);
    if (!msg) return null;

    const currentDeletedFor = Array.isArray(msg.deletedFor) ? msg.deletedFor : [];
    const updatedDeletedFor = Array.from(new Set([...currentDeletedFor, userId]));

    return prisma.message.update({
      where: { id: messageId },
      data: { deletedFor: updatedDeletedFor },
    });
  }

  async deleteForEveryone(messageId) {
    return prisma.message.update({
      where: { id: messageId },
      data: { isDeleted: true, text: 'This message was deleted' },
    });
  }

  async deleteAll() {
    return prisma.message.deleteMany({});
  }
}

export default new MessageRepository();
