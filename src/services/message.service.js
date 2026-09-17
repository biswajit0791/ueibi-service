import messageRepository from '../repositories/message.repository.js';
import { prisma } from '../lib/prisma.js';
import { env } from '../config/env.js';
import { publishKafkaEvent } from '../lib/kafka.js';
import { conversationIdFor, participantsOf } from '../lib/conversation.js';
import {
  getConversationFromMongo,
  getConversationListFromMongo,
  getUnreadCountsFromMongo,
  toWireMessage,
} from './messageMongo.service.js';
import { CHAT_EVENTS, applyChatEvent } from './messageKafkaConsumer.service.js';

const MAX_TEXT_LENGTH = 4000;

// Write path for every chat mutation:
//   1. write to PostgreSQL (source of truth, synchronous)
//   2. publish a Kafka event on the chat topic
//   3. the Kafka consumer projects it into MongoDB and fans out over Socket.IO
// If the Kafka producer is offline, step 3 is applied inline (write-through) so
// the feature degrades to direct delivery instead of breaking.
async function dispatch(eventType, payload) {
  const sent = await publishKafkaEvent(
    env.kafkaTopicChat,
    eventType,
    payload,
    payload.conversationId // partition key: one conversation keeps its ordering
  );
  if (!sent) {
    await applyChatEvent(eventType, payload);
  }
  return sent;
}

export class MessageService {
  // Verifies the peer is a real, active user inside the SAME tenant, then
  // returns the deterministic conversation id for the pair.
  async resolveConversation({ tenantId, userId, peerId }) {
    if (!peerId) throw Object.assign(new Error('peerId is required'), { status: 400 });
    if (peerId === userId) {
      throw Object.assign(new Error('Cannot open a conversation with yourself'), { status: 400 });
    }

    const peer = await prisma.tenantUser.findFirst({
      where: { id: peerId, tenantId, isDeleted: false },
      select: { id: true, name: true, status: true },
    });
    if (!peer) {
      throw Object.assign(new Error('Recipient not found in this organisation'), { status: 404 });
    }

    return { conversationId: conversationIdFor(tenantId, userId, peerId), peer };
  }

  async sendMessage({ tenantId, senderId, peerId, text, mediaUrl, mediaType, fileName, fileSize }) {
    const trimmed = (text || '').trim();
    if (!trimmed && !mediaUrl) {
      throw Object.assign(new Error('Message text or media is required'), { status: 400 });
    }
    if (trimmed.length > MAX_TEXT_LENGTH) {
      throw Object.assign(new Error(`Message exceeds ${MAX_TEXT_LENGTH} characters`), { status: 400 });
    }

    const { conversationId } = await this.resolveConversation({ tenantId, userId: senderId, peerId });

    const saved = await messageRepository.create({
      tenantId,
      conversationId,
      senderId,
      receiverId: peerId,
      text: trimmed,
      mediaUrl,
      mediaType,
      fileName,
      fileSize,
    });

    const wire = toWireMessage(saved);
    await dispatch(CHAT_EVENTS.MESSAGE_CREATED, wire);
    return wire;
  }

  // Read path: MongoDB first, PostgreSQL as the fallback when Mongo is down.
  async getConversation({ tenantId, userId, peerId, limit, before }) {
    const { conversationId } = await this.resolveConversation({ tenantId, userId, peerId });

    const fromMongo = await getConversationFromMongo({
      tenantId,
      conversationId,
      userId,
      limit,
      before,
    });
    if (fromMongo !== null) {
      return { conversationId, source: 'mongodb', messages: fromMongo };
    }

    const rows = await messageRepository.findConversation({
      tenantId,
      conversationId,
      userId,
      limit,
      before,
    });
    return { conversationId, source: 'postgres', messages: rows.map((r) => toWireMessage(r)) };
  }

  async deleteForMe({ tenantId, userId, messageId }) {
    const msg = await messageRepository.findById(messageId, tenantId);
    if (!msg) throw Object.assign(new Error('Message not found'), { status: 404 });
    if (msg.senderId !== userId && msg.receiverId !== userId) {
      throw Object.assign(new Error('Not a participant in this conversation'), { status: 403 });
    }

    await messageRepository.deleteForUser({ messageId, tenantId, userId });
    await dispatch(CHAT_EVENTS.MESSAGE_DELETED_FOR_ME, {
      tenantId,
      conversationId: msg.conversationId,
      messageId,
      userId,
    });
    return { messageId };
  }

  async deleteForEveryone({ tenantId, userId, messageId }) {
    const msg = await messageRepository.findById(messageId, tenantId);
    if (!msg) throw Object.assign(new Error('Message not found'), { status: 404 });
    // Only the author may retract a message for both sides.
    if (msg.senderId !== userId) {
      throw Object.assign(new Error('Only the sender can delete a message for everyone'), { status: 403 });
    }

    await messageRepository.deleteForEveryone({ messageId, tenantId });
    await dispatch(CHAT_EVENTS.MESSAGE_DELETED_FOR_EVERYONE, {
      tenantId,
      conversationId: msg.conversationId,
      messageId,
      senderId: msg.senderId,
      receiverId: msg.receiverId,
    });
    return { messageId };
  }

  // Clears only the requesting user's view of one conversation.
  async clearConversation({ tenantId, userId, peerId }) {
    const { conversationId } = await this.resolveConversation({ tenantId, userId, peerId });
    const cleared = await messageRepository.clearConversationForUser({ tenantId, conversationId, userId });

    await dispatch(CHAT_EVENTS.CONVERSATION_CLEARED, {
      tenantId,
      conversationId,
      userId,
    });
    return { conversationId, cleared };
  }

  async markRead({ tenantId, userId, peerId }) {
    const { conversationId } = await this.resolveConversation({ tenantId, userId, peerId });
    const readAt = new Date();
    const count = await messageRepository.markConversationRead({
      tenantId,
      conversationId,
      readerId: userId,
      readAt,
    });

    if (count > 0) {
      await dispatch(CHAT_EVENTS.CONVERSATION_READ, {
        tenantId,
        conversationId,
        readerId: userId,
        peerId,
        readAt: readAt.toISOString(),
      });
    }
    return { conversationId, read: count };
  }

  async markDelivered({ tenantId, userId, conversationId }) {
    const deliveredAt = new Date();
    const ids = await messageRepository.markDelivered({
      tenantId,
      conversationId,
      receiverId: userId,
      deliveredAt,
    });
    if (ids.length === 0) return { delivered: 0 };

    await dispatch(CHAT_EVENTS.MESSAGES_DELIVERED, {
      tenantId,
      conversationId,
      receiverId: userId,
      messageIds: ids,
      deliveredAt: deliveredAt.toISOString(),
    });
    return { delivered: ids.length };
  }

  // Inbox: every conversation the user takes part in, resolved to the peer's
  // profile, with the last message and unread count. Mongo-first, PG fallback.
  async getConversations({ tenantId, userId }) {
    const fromMongo = await getConversationListFromMongo({ tenantId, userId });
    const source = fromMongo !== null ? 'mongodb' : 'postgres';

    const rows =
      fromMongo !== null
        ? fromMongo
        : (await messageRepository.findConversationList({ tenantId, userId })).map((r) => ({
            conversationId: r.conversationId,
            unread: r.unread,
            lastMessage: toWireMessage(r.last),
          }));

    // Map each conversation to the other participant.
    const peerIdByConversation = new Map();
    for (const row of rows) {
      const pair = participantsOf(row.conversationId);
      if (!pair) continue; // quarantined legacy bucket — never surfaced
      const peerId = pair.find((p) => p !== userId);
      if (peerId) peerIdByConversation.set(row.conversationId, peerId);
    }

    const peers = await prisma.tenantUser.findMany({
      where: { id: { in: [...new Set(peerIdByConversation.values())] }, tenantId, isDeleted: false },
      select: { id: true, name: true, designation: true, department: true, role: true, profileSnaps: true },
    });
    const peerById = new Map(peers.map((p) => [p.id, p]));

    const conversations = rows
      .map((row) => {
        const peerId = peerIdByConversation.get(row.conversationId);
        const peer = peerId ? peerById.get(peerId) : null;
        if (!peer) return null; // peer deleted or not in this tenant
        return { ...row, peer };
      })
      .filter(Boolean);

    return { source, conversations };
  }

  async getUnreadCounts({ tenantId, userId }) {
    const fromMongo = await getUnreadCountsFromMongo({ tenantId, userId });
    if (fromMongo !== null) return { source: 'mongodb', conversations: fromMongo };

    const rows = await messageRepository.countUnread({ tenantId, userId });
    return {
      source: 'postgres',
      conversations: rows.map((r) => ({
        conversationId: r.conversationId,
        unread: r._count._all,
        lastAt: r._max.createdAt,
      })),
    };
  }
}

export default new MessageService();
