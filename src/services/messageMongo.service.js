import { isMongoConnected } from '../lib/mongo.js';
import { MessageMongo } from '../models/messageMongo.model.js';

// Shape returned to clients. Both the Mongo and PostgreSQL read paths funnel
// through this so the frontend sees one consistent message object regardless of
// which store answered.
export function toWireMessage(doc, viewerId) {
  if (!doc) return null;
  const id = doc.postgresId || doc.id || String(doc._id);
  const isDeleted = Boolean(doc.isDeleted);
  return {
    id,
    tenantId: doc.tenantId,
    conversationId: doc.conversationId,
    senderId: doc.senderId,
    receiverId: doc.receiverId ?? null,
    text: isDeleted ? 'This message was deleted' : (doc.text || ''),
    mediaUrl: isDeleted ? null : (doc.mediaUrl ?? null),
    mediaType: isDeleted ? null : (doc.mediaType ?? null),
    fileName: isDeleted ? null : (doc.fileName ?? null),
    fileSize: isDeleted ? null : (doc.fileSize ?? null),
    status: doc.status || 'SENT',
    deliveredAt: doc.deliveredAt ?? null,
    readAt: doc.readAt ?? null,
    isDeleted,
    createdAt: doc.createdAt,
  };
}

export async function saveMessageInMongo(message) {
  if (!isMongoConnected()) return null;
  try {
    // Upsert keyed on postgresId so a replayed Kafka event is idempotent.
    await MessageMongo.updateOne(
      { postgresId: String(message.id) },
      {
        $set: {
          tenantId: message.tenantId,
          conversationId: message.conversationId,
          senderId: message.senderId,
          receiverId: message.receiverId ?? null,
          text: message.text || '',
          mediaUrl: message.mediaUrl ?? null,
          mediaType: message.mediaType ?? null,
          fileName: message.fileName ?? null,
          fileSize: message.fileSize ?? null,
          status: message.status || 'SENT',
          deliveredAt: message.deliveredAt ?? null,
          readAt: message.readAt ?? null,
          isDeleted: Boolean(message.isDeleted),
          createdAt: message.createdAt ? new Date(message.createdAt) : new Date(),
        },
        $setOnInsert: { postgresId: String(message.id), deletedFor: [] },
      },
      { upsert: true }
    );
    return true;
  } catch (err) {
    console.warn(`[Mongo] Failed to save chat message: ${err.message}`);
    return false;
  }
}

export async function markDeletedForUserInMongo({ messageId, userId }) {
  if (!isMongoConnected()) return false;
  try {
    await MessageMongo.updateOne(
      { postgresId: String(messageId) },
      { $addToSet: { deletedFor: String(userId) } }
    );
    return true;
  } catch (err) {
    console.warn(`[Mongo] Failed to mark message deleted for user: ${err.message}`);
    return false;
  }
}

export async function markDeletedForEveryoneInMongo({ messageId }) {
  if (!isMongoConnected()) return false;
  try {
    await MessageMongo.updateOne(
      { postgresId: String(messageId) },
      {
        $set: {
          isDeleted: true,
          text: 'This message was deleted',
          mediaUrl: null,
          mediaType: null,
          fileName: null,
          fileSize: null,
        },
      }
    );
    return true;
  } catch (err) {
    console.warn(`[Mongo] Failed to mark message deleted for everyone: ${err.message}`);
    return false;
  }
}

export async function markConversationReadInMongo({ tenantId, conversationId, readerId, readAt }) {
  if (!isMongoConnected()) return false;
  try {
    await MessageMongo.updateMany(
      { tenantId, conversationId, receiverId: String(readerId), status: { $ne: 'READ' } },
      { $set: { status: 'READ', readAt: readAt ? new Date(readAt) : new Date() } }
    );
    return true;
  } catch (err) {
    console.warn(`[Mongo] Failed to mark conversation read: ${err.message}`);
    return false;
  }
}

export async function markDeliveredInMongo({ tenantId, conversationId, messageIds, deliveredAt }) {
  if (!isMongoConnected()) return false;
  try {
    await MessageMongo.updateMany(
      {
        tenantId,
        conversationId,
        postgresId: { $in: (messageIds || []).map(String) },
        status: 'SENT',
      },
      { $set: { status: 'DELIVERED', deliveredAt: deliveredAt ? new Date(deliveredAt) : new Date() } }
    );
    return true;
  } catch (err) {
    console.warn(`[Mongo] Failed to mark messages delivered: ${err.message}`);
    return false;
  }
}

export async function clearConversationForUserInMongo({ tenantId, conversationId, userId }) {
  if (!isMongoConnected()) return false;
  try {
    await MessageMongo.updateMany(
      { tenantId, conversationId },
      { $addToSet: { deletedFor: String(userId) } }
    );
    return true;
  } catch (err) {
    console.warn(`[Mongo] Failed to clear conversation: ${err.message}`);
    return false;
  }
}

// Primary read path: one conversation, newest-last, excluding anything the
// viewer deleted for themselves. Returns null (not []) when Mongo is
// unavailable so callers can tell "empty" apart from "fall back to Postgres".
export async function getConversationFromMongo({ tenantId, conversationId, userId, limit = 100, before }) {
  if (!isMongoConnected()) return null;
  try {
    const filter = {
      tenantId,
      conversationId,
      deletedFor: { $ne: String(userId) },
    };
    if (before) filter.createdAt = { $lt: new Date(before) };

    const docs = await MessageMongo.find(filter)
      .sort({ createdAt: -1 })
      .limit(Math.min(Number(limit) || 100, 200))
      .lean();

    return docs.reverse().map((d) => toWireMessage(d, userId));
  } catch (err) {
    console.warn(`[Mongo] Failed to read conversation ${conversationId}: ${err.message}`);
    return null;
  }
}

// Inbox list: one row per conversation the user takes part in, carrying the
// most recent message and that conversation's unread count, newest first.
export async function getConversationListFromMongo({ tenantId, userId, limit = 200 }) {
  if (!isMongoConnected()) return null;
  try {
    const uid = String(userId);
    const rows = await MessageMongo.aggregate([
      {
        $match: {
          tenantId,
          $or: [{ senderId: uid }, { receiverId: uid }],
          deletedFor: { $ne: uid },
        },
      },
      { $sort: { createdAt: -1 } },
      {
        $group: {
          _id: '$conversationId',
          last: { $first: '$$ROOT' },
          unread: {
            $sum: {
              $cond: [
                {
                  $and: [
                    { $eq: ['$receiverId', uid] },
                    { $ne: ['$status', 'READ'] },
                    { $eq: ['$isDeleted', false] },
                  ],
                },
                1,
                0,
              ],
            },
          },
        },
      },
      { $sort: { 'last.createdAt': -1 } },
      { $limit: Math.min(Number(limit) || 200, 500) },
    ]);

    return rows.map((r) => ({
      conversationId: r._id,
      unread: r.unread,
      lastMessage: toWireMessage(r.last, uid),
    }));
  } catch (err) {
    console.warn(`[Mongo] Failed to read conversation list: ${err.message}`);
    return null;
  }
}

// Unread counts grouped by conversation, for inbox badges.
export async function getUnreadCountsFromMongo({ tenantId, userId }) {
  if (!isMongoConnected()) return null;
  try {
    const rows = await MessageMongo.aggregate([
      {
        $match: {
          tenantId,
          receiverId: String(userId),
          status: { $ne: 'READ' },
          isDeleted: false,
          deletedFor: { $ne: String(userId) },
        },
      },
      { $group: { _id: '$conversationId', count: { $sum: 1 }, lastAt: { $max: '$createdAt' } } },
    ]);
    return rows.map((r) => ({ conversationId: r._id, unread: r.count, lastAt: r.lastAt }));
  } catch (err) {
    console.warn(`[Mongo] Failed to read unread counts: ${err.message}`);
    return null;
  }
}

// Boot-time backfill so the Mongo read model is never behind PostgreSQL after
// the deploy that introduced it (or after Mongo was wiped). Only runs when the
// collection is empty, mirroring the gallery sync.
export async function syncMessagesFromPostgres(prisma) {
  if (!isMongoConnected() || !prisma) return;

  try {
    const mongoCount = await MessageMongo.countDocuments();
    if (mongoCount > 0) return;

    const pgMessages = await prisma.message.findMany({
      where: { tenantId: { not: '__legacy__' } },
      orderBy: { createdAt: 'asc' },
      take: 20000,
    });

    if (pgMessages.length === 0) return;
    console.log(` [MongoDB] Backfilling ${pgMessages.length} chat messages from PostgreSQL...`);

    const ops = pgMessages.map((m) => ({
      updateOne: {
        filter: { postgresId: m.id },
        update: {
          $setOnInsert: {
            postgresId: m.id,
            tenantId: m.tenantId,
            conversationId: m.conversationId,
            senderId: m.senderId,
            receiverId: m.receiverId,
            text: m.text,
            mediaUrl: m.mediaUrl,
            mediaType: m.mediaType,
            fileName: m.fileName,
            fileSize: m.fileSize,
            status: m.status,
            deliveredAt: m.deliveredAt,
            readAt: m.readAt,
            isDeleted: m.isDeleted,
            deletedFor: m.deletedFor || [],
            createdAt: m.createdAt,
          },
        },
        upsert: true,
      },
    }));

    for (let i = 0; i < ops.length; i += 500) {
      await MessageMongo.bulkWrite(ops.slice(i, i + 500), { ordered: false });
    }
  } catch (err) {
    console.warn(` [MongoDB] Notice: chat backfill skipped (${err.message})`);
  }
}
