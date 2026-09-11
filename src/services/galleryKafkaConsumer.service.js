import { getKafkaInstance } from '../lib/kafka.js';
import { env } from '../config/env.js';
import { emitToTenant } from '../lib/socket.js';
import {
  saveLikeInMongo,
  removeLikeFromMongo,
  saveCommentInMongo,
  deleteCommentFromMongo,
  getPostLikeStatsFromMongo,
} from './galleryMongo.service.js';

let consumer = null;
let isConsumerRunning = false;

export async function initGalleryKafkaConsumer() {
  if (isConsumerRunning && consumer) {
    return consumer;
  }

  try {
    const k = getKafkaInstance();
    consumer = k.consumer({
      groupId: env.kafkaGroupId,
      allowAutoTopicCreation: true,
    });

    await consumer.connect();
    await consumer.subscribe({
      topic: env.kafkaTopicGallery,
      fromBeginning: false,
    });

    isConsumerRunning = true;
    console.log(` Apache Kafka: Consumer active [topic: ${env.kafkaTopicGallery}, group: ${env.kafkaGroupId}]`);

    await consumer.run({
      eachMessage: async ({ topic, partition, message }) => {
        try {
          const rawValue = message.value?.toString();
          if (!rawValue) return;

          const data = JSON.parse(rawValue);
          const { eventType, payload } = data;

          await handleGalleryEvent(eventType, payload);
        } catch (err) {
          console.warn(`[Kafka Consumer] Failed to process message on ${topic}: ${err.message}`);
        }
      },
    });

    return consumer;
  } catch (err) {
    isConsumerRunning = false;
    consumer = null;
    console.warn(` [Kafka] Notice: Consumer not connected (${err.message}). Events processed via direct write-through.`);
    return null;
  }
}

export async function handleGalleryEvent(eventType, payload = {}) {
  const { tenantId, postId, userId } = payload;

  switch (eventType) {
    case 'GALLERY_POST_LIKED': {
      await saveLikeInMongo({ tenantId, postId, userId });
      const stats = await getPostLikeStatsFromMongo(postId, userId);
      emitToTenant(tenantId, 'gallery_like_updated', {
        postId,
        likeCount: stats?.likeCount,
        userId,
        liked: true,
      });
      break;
    }

    case 'GALLERY_POST_UNLIKED': {
      await removeLikeFromMongo({ postId, userId });
      const stats = await getPostLikeStatsFromMongo(postId, userId);
      emitToTenant(tenantId, 'gallery_like_updated', {
        postId,
        likeCount: stats?.likeCount,
        userId,
        liked: false,
      });
      break;
    }

    case 'GALLERY_COMMENT_CREATED': {
      const { commentId, authorId, authorName, text, createdAt } = payload;
      await saveCommentInMongo({
        postgresId: commentId,
        tenantId,
        postId,
        authorId,
        authorName,
        text,
        createdAt,
      });
      emitToTenant(tenantId, 'gallery_comment_added', {
        postId,
        comment: {
          id: commentId,
          author: authorName,
          authorId,
          text,
          createdAt,
        },
      });
      break;
    }

    case 'GALLERY_COMMENT_DELETED': {
      const { commentId } = payload;
      await deleteCommentFromMongo({ postgresId: commentId, postId });
      emitToTenant(tenantId, 'gallery_comment_deleted', {
        postId,
        commentId,
      });
      break;
    }

    default:
      console.log(`[Kafka Consumer] Unknown event type: ${eventType}`);
  }
}

export async function stopGalleryKafkaConsumer() {
  if (consumer && isConsumerRunning) {
    try {
      await consumer.disconnect();
    } catch { /* noop */ }
    isConsumerRunning = false;
    consumer = null;
  }
}
