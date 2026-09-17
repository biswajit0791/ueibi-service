import { getKafkaInstance } from '../lib/kafka.js';
import { env } from '../config/env.js';
import { emitToUser } from '../lib/socket.js';
import { participantsOf } from '../lib/conversation.js';
import {
  saveMessageInMongo,
  markDeletedForUserInMongo,
  markDeletedForEveryoneInMongo,
  markConversationReadInMongo,
  markDeliveredInMongo,
  clearConversationForUserInMongo,
} from './messageMongo.service.js';

export const CHAT_EVENTS = {
  MESSAGE_CREATED: 'CHAT_MESSAGE_CREATED',
  MESSAGE_DELETED_FOR_ME: 'CHAT_MESSAGE_DELETED_FOR_ME',
  MESSAGE_DELETED_FOR_EVERYONE: 'CHAT_MESSAGE_DELETED_FOR_EVERYONE',
  CONVERSATION_CLEARED: 'CHAT_CONVERSATION_CLEARED',
  CONVERSATION_READ: 'CHAT_CONVERSATION_READ',
  MESSAGES_DELIVERED: 'CHAT_MESSAGES_DELIVERED',
};

let consumer = null;
let isConsumerRunning = false;

// Deliver a socket event to both participants of a conversation. Uses the
// per-user rooms from lib/socket.js, so a message is never broadcast to a
// tenant-wide room where non-participants would receive it.
function emitToConversation(tenantId, conversationId, event, payload, { only } = {}) {
  const pair = participantsOf(conversationId);
  if (!pair) return;
  const targets = only ? [only] : pair;
  for (const userId of targets) {
    emitToUser(tenantId, userId, event, payload);
  }
}

// The projection itself. Called by the Kafka consumer, and called directly as a
// write-through fallback when the Kafka producer is offline, so both paths run
// exactly the same code.
export async function applyChatEvent(eventType, payload = {}) {
  const { tenantId, conversationId } = payload;

  switch (eventType) {
    case CHAT_EVENTS.MESSAGE_CREATED: {
      await saveMessageInMongo(payload);
      emitToConversation(tenantId, conversationId, 'chat:message', payload);
      break;
    }

    case CHAT_EVENTS.MESSAGE_DELETED_FOR_ME: {
      const { messageId, userId } = payload;
      await markDeletedForUserInMongo({ messageId, userId });
      // Only the user who deleted it should see it disappear.
      emitToConversation(tenantId, conversationId, 'chat:message_deleted_for_me', { messageId, conversationId }, { only: userId });
      break;
    }

    case CHAT_EVENTS.MESSAGE_DELETED_FOR_EVERYONE: {
      const { messageId } = payload;
      await markDeletedForEveryoneInMongo({ messageId });
      emitToConversation(tenantId, conversationId, 'chat:message_deleted', { messageId, conversationId });
      break;
    }

    case CHAT_EVENTS.CONVERSATION_CLEARED: {
      const { userId } = payload;
      await clearConversationForUserInMongo({ tenantId, conversationId, userId });
      emitToConversation(tenantId, conversationId, 'chat:conversation_cleared', { conversationId }, { only: userId });
      break;
    }

    case CHAT_EVENTS.CONVERSATION_READ: {
      const { readerId, readAt } = payload;
      await markConversationReadInMongo({ tenantId, conversationId, readerId, readAt });
      // The other participant is the one who needs the read receipt.
      emitToConversation(tenantId, conversationId, 'chat:conversation_read', {
        conversationId,
        readerId,
        readAt,
      });
      break;
    }

    case CHAT_EVENTS.MESSAGES_DELIVERED: {
      const { messageIds, deliveredAt } = payload;
      await markDeliveredInMongo({ tenantId, conversationId, messageIds, deliveredAt });
      emitToConversation(tenantId, conversationId, 'chat:messages_delivered', {
        conversationId,
        messageIds,
        deliveredAt,
      });
      break;
    }

    default:
      console.warn(`[Kafka Chat Consumer] Unknown event type: ${eventType}`);
  }
}

export async function initChatKafkaConsumer() {
  if (isConsumerRunning && consumer) {
    return consumer;
  }

  try {
    const k = getKafkaInstance();
    consumer = k.consumer({
      groupId: env.kafkaGroupIdChat,
      allowAutoTopicCreation: true,
    });

    await consumer.connect();
    await consumer.subscribe({ topic: env.kafkaTopicChat, fromBeginning: false });

    isConsumerRunning = true;
    console.log(` Apache Kafka: Chat consumer active [topic: ${env.kafkaTopicChat}, group: ${env.kafkaGroupIdChat}]`);

    await consumer.run({
      eachMessage: async ({ topic, message }) => {
        try {
          const rawValue = message.value?.toString();
          if (!rawValue) return;
          const { eventType, payload } = JSON.parse(rawValue);
          await applyChatEvent(eventType, payload);
        } catch (err) {
          console.warn(`[Kafka Chat Consumer] Failed to process message on ${topic}: ${err.message}`);
        }
      },
    });

    return consumer;
  } catch (err) {
    isConsumerRunning = false;
    consumer = null;
    console.warn(` [Kafka] Notice: Chat consumer not connected (${err.message}). Chat events processed via direct write-through.`);
    return null;
  }
}

export async function stopChatKafkaConsumer() {
  if (consumer && isConsumerRunning) {
    try {
      await consumer.disconnect();
    } catch { /* noop */ }
    isConsumerRunning = false;
    consumer = null;
  }
}
