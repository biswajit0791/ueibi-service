import mongoose from 'mongoose';

// MongoDB read model for chat. PostgreSQL remains the source of truth; this
// collection is kept in sync by the Kafka chat consumer and is what every read
// path queries first. `postgresId` mirrors the Prisma `Message.id` so both
// stores address the same message with one identifier.
const messageSchema = new mongoose.Schema(
  {
    postgresId: { type: String, required: true, unique: true, index: true },
    tenantId: { type: String, required: true, index: true },
    conversationId: { type: String, required: true, index: true },
    senderId: { type: String, required: true, index: true },
    receiverId: { type: String, default: null, index: true },
    text: { type: String, default: '' },
    mediaUrl: { type: String, default: null },
    mediaType: { type: String, default: null },
    fileName: { type: String, default: null },
    fileSize: { type: Number, default: null },
    status: { type: String, enum: ['SENT', 'DELIVERED', 'READ'], default: 'SENT' },
    deliveredAt: { type: Date, default: null },
    readAt: { type: Date, default: null },
    isDeleted: { type: Boolean, default: false },
    deletedFor: { type: [String], default: [] },
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now },
  },
  {
    collection: 'chat_messages',
    timestamps: true,
  }
);

// Primary read pattern: one conversation's history in chronological order.
messageSchema.index({ tenantId: 1, conversationId: 1, createdAt: 1 });
// Unread badge counts per recipient.
messageSchema.index({ tenantId: 1, receiverId: 1, status: 1 });

export const MessageMongo =
  mongoose.models.ChatMessage || mongoose.model('ChatMessage', messageSchema);
