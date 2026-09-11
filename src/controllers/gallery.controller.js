import { prisma } from '../lib/prisma.js';
import path from 'node:path';
import fs from 'node:fs';
import { env } from '../config/env.js';
import { publishKafkaEvent, isKafkaProducerReady } from '../lib/kafka.js';
import { emitToTenant } from '../lib/socket.js';
import {
  getCommentsFromMongo,
  getPostLikeStatsFromMongo,
  enrichPostsWithMongoData,
  saveLikeInMongo,
  removeLikeFromMongo,
  saveCommentInMongo,
  deleteCommentFromMongo,
} from '../services/galleryMongo.service.js';
import {
  ALLOWED_GALLERY_CATEGORIES,
  createGalleryPostSchema,
  addGalleryCommentSchema,
} from '../validations/gallery.schema.js';

// Helper to build full image URL
function buildImageUrl(imageUrl) {
  if (!imageUrl) return '';
  if (imageUrl.startsWith('http://') || imageUrl.startsWith('https://')) return imageUrl;
  const clean = imageUrl.startsWith('/') ? imageUrl : `/${imageUrl}`;
  return clean;
}

// Serialize a post for the client
function serializePost(post, userId) {
  const userLiked = (post.likes || []).some((l) => l.userId === userId);
  return {
    id: post.id,
    title: post.title,
    category: post.category,
    imageUrl: buildImageUrl(post.imageUrl),
    likeCount: post.likeCount || 0,
    commentCount: post.commentCount || 0,
    uploader: post.uploadedBy?.name || 'Team Member',
    uploadedById: post.uploadedById,
    createdAt: post.createdAt,
    userLiked,
    comments: (post.comments || []).map((c) => ({
      id: c.id,
      author: c.author?.name || 'Team Member',
      authorId: c.authorId,
      text: c.text,
      createdAt: c.createdAt,
    })),
  };
}

// GET /gallery/posts
export async function listGalleryPosts(req, res, next) {
  try {
    const tenantId = req.tenantId;
    const userId = req.user.id;
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit) || 12));
    const skip = (page - 1) * limit;
    const category = req.query.category || '';
    const search = (req.query.search || '').trim();

    const where = { tenantId, isActive: true };
    if (category && ALLOWED_GALLERY_CATEGORIES.includes(category)) {
      where.category = category;
    }
    if (search) {
      where.OR = [
        { title: { contains: search, mode: 'insensitive' } },
        { category: { contains: search, mode: 'insensitive' } },
      ];
    }

    const [total, posts] = await Promise.all([
      prisma.galleryPost.count({ where }),
      prisma.galleryPost.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
        include: {
          uploadedBy: { select: { id: true, name: true } },
          likes: { select: { userId: true } },
          comments: {
            orderBy: { createdAt: 'asc' },
            include: { author: { select: { id: true, name: true } } },
          },
        },
      }),
    ]);

    const serialized = posts.map((p) => serializePost(p, userId));
    // Read and enrich with real-time MongoDB data (likes, userLiked, comments)
    const enriched = await enrichPostsWithMongoData(serialized, userId);

    const totalPages = Math.ceil(total / limit) || 1;
    res.json({
      items: enriched,
      pagination: { page, limit, total, totalPages, hasNextPage: page < totalPages, hasPrevPage: page > 1 },
    });
  } catch (err) {
    next(err);
  }
}

// POST /gallery/posts (multipart/form-data with image file)
export async function createGalleryPost(req, res, next) {
  try {
    const tenantId = req.tenantId;
    const user = req.user;

    if (!req.file) {
      return res.status(400).json({ error: 'An image file is required' });
    }

    const parsed = createGalleryPostSchema.safeParse(req.body || {});
    if (!parsed.success) {
      return res.status(400).json({ error: 'Validation failed', details: parsed.error.issues });
    }
    const { title, category } = parsed.data;

    const imageUrl = `/uploads/${req.file.filename}`;

    const post = await prisma.galleryPost.create({
      data: { tenantId, uploadedById: user.id, title, category, imageUrl },
      include: {
        uploadedBy: { select: { id: true, name: true } },
        likes: { select: { userId: true } },
        comments: { include: { author: { select: { id: true, name: true } } } },
      },
    });

    const serialized = serializePost(post, user.id);
    emitToTenant(tenantId, 'gallery_post_created', { post: serialized });

    res.status(201).json({ message: 'Gallery post created', post: serialized });
  } catch (err) {
    next(err);
  }
}

// DELETE /gallery/posts/:id
export async function deleteGalleryPost(req, res, next) {
  try {
    const tenantId = req.tenantId;
    const user = req.user;
    const { id } = req.params;

    const post = await prisma.galleryPost.findFirst({ where: { id, tenantId } });
    if (!post) return res.status(404).json({ error: 'Post not found' });

    const privilegedRoles = ['HR', 'CMD', 'ADMIN', 'SUPER_ADMIN'];
    const isAuthor = post.uploadedById === user.id;
    if (!isAuthor && !privilegedRoles.includes(user.role)) {
      return res.status(403).json({ error: 'Forbidden: You cannot delete this post' });
    }

    await prisma.galleryPost.update({ where: { id }, data: { isActive: false } });

    try {
      if (post.imageUrl && post.imageUrl.startsWith('/uploads/')) {
        const filePath = path.join('./uploads', path.basename(post.imageUrl));
        if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
      }
    } catch { /* non-fatal */ }

    emitToTenant(tenantId, 'gallery_post_deleted', { id });
    res.json({ message: 'Post deleted', id });
  } catch (err) {
    next(err);
  }
}

// POST /gallery/posts/:id/like
export async function toggleGalleryLike(req, res, next) {
  try {
    const tenantId = req.tenantId;
    const userId = req.user.id;
    const { id: postId } = req.params;

    const post = await prisma.galleryPost.findFirst({ where: { id: postId, tenantId, isActive: true } });
    if (!post) return res.status(404).json({ error: 'Post not found' });

    const existing = await prisma.galleryLike.findUnique({
      where: { postId_userId: { postId, userId } },
    });

    let newLikedState = false;
    let finalLikeCount = 0;

    if (existing) {
      // 1. Update PostgreSQL
      await prisma.$transaction([
        prisma.galleryLike.delete({ where: { postId_userId: { postId, userId } } }),
        prisma.galleryPost.update({ where: { id: postId }, data: { likeCount: { decrement: 1 } } }),
      ]);
      newLikedState = false;

      // 2. Publish event to Apache Kafka topic
      const kafkaSent = await publishKafkaEvent(
        env.kafkaTopicGallery,
        'GALLERY_POST_UNLIKED',
        { tenantId, postId, userId },
        postId
      );

      // 3. Fallback direct Mongo update if Kafka producer is offline
      if (!kafkaSent) {
        await removeLikeFromMongo({ postId, userId });
      }

      // 4. Read latest counts from MongoDB (fallback to Postgres count)
      const mongoStats = await getPostLikeStatsFromMongo(postId, userId);
      finalLikeCount = mongoStats !== null ? mongoStats.likeCount : Math.max(0, post.likeCount - 1);

      // 5. Broadcast real-time update
      emitToTenant(tenantId, 'gallery_like_updated', {
        postId,
        likeCount: finalLikeCount,
        userId,
        liked: false,
      });
    } else {
      // 1. Update PostgreSQL
      await prisma.$transaction([
        prisma.galleryLike.create({ data: { tenantId, postId, userId } }),
        prisma.galleryPost.update({ where: { id: postId }, data: { likeCount: { increment: 1 } } }),
      ]);
      newLikedState = true;

      // 2. Publish event to Apache Kafka topic
      const kafkaSent = await publishKafkaEvent(
        env.kafkaTopicGallery,
        'GALLERY_POST_LIKED',
        { tenantId, postId, userId },
        postId
      );

      // 3. Fallback direct Mongo update if Kafka producer is offline
      if (!kafkaSent) {
        await saveLikeInMongo({ tenantId, postId, userId });
      }

      // 4. Read latest counts from MongoDB (fallback to Postgres count)
      const mongoStats = await getPostLikeStatsFromMongo(postId, userId);
      finalLikeCount = mongoStats !== null ? mongoStats.likeCount : post.likeCount + 1;

      // 5. Broadcast real-time update
      emitToTenant(tenantId, 'gallery_like_updated', {
        postId,
        likeCount: finalLikeCount,
        userId,
        liked: true,
      });
    }

    res.json({ liked: newLikedState, likeCount: finalLikeCount });
  } catch (err) {
    next(err);
  }
}

// GET /gallery/posts/:id/comments
export async function getGalleryComments(req, res, next) {
  try {
    const tenantId = req.tenantId;
    const { id: postId } = req.params;

    const post = await prisma.galleryPost.findFirst({ where: { id: postId, tenantId, isActive: true } });
    if (!post) return res.status(404).json({ error: 'Post not found' });

    // 1. Read comments directly from MongoDB
    const mongoComments = await getCommentsFromMongo(postId);
    if (mongoComments !== null) {
      return res.json({ comments: mongoComments });
    }

    // 2. Fallback to PostgreSQL if MongoDB is offline
    const pgComments = await prisma.galleryComment.findMany({
      where: { postId },
      orderBy: { createdAt: 'asc' },
      include: { author: { select: { id: true, name: true } } },
    });

    res.json({
      comments: pgComments.map((c) => ({
        id: c.id,
        author: c.author?.name || 'Team Member',
        authorId: c.authorId,
        text: c.text,
        createdAt: c.createdAt,
      })),
    });
  } catch (err) {
    next(err);
  }
}

// POST /gallery/posts/:id/comments
export async function addGalleryComment(req, res, next) {
  try {
    const tenantId = req.tenantId;
    const userId = req.user.id;
    const userName = req.user.name;
    const { id: postId } = req.params;

    const parsed = addGalleryCommentSchema.safeParse(req.body || {});
    if (!parsed.success) {
      return res.status(400).json({ error: 'Validation failed', details: parsed.error.issues });
    }
    const { text } = parsed.data;

    const post = await prisma.galleryPost.findFirst({ where: { id: postId, tenantId, isActive: true } });
    if (!post) return res.status(404).json({ error: 'Post not found' });

    // 1. Insert into PostgreSQL
    const [comment] = await prisma.$transaction([
      prisma.galleryComment.create({
        data: { tenantId, postId, authorId: userId, text },
        include: { author: { select: { id: true, name: true } } },
      }),
      prisma.galleryPost.update({ where: { id: postId }, data: { commentCount: { increment: 1 } } }),
    ]);

    const commentData = {
      id: comment.id,
      author: comment.author?.name || userName || 'Team Member',
      authorId: comment.authorId,
      text: comment.text,
      createdAt: comment.createdAt,
    };

    // 2. Publish event to Apache Kafka topic
    const kafkaSent = await publishKafkaEvent(
      env.kafkaTopicGallery,
      'GALLERY_COMMENT_CREATED',
      {
        commentId: comment.id,
        tenantId,
        postId,
        authorId: userId,
        authorName: commentData.author,
        text: comment.text,
        createdAt: comment.createdAt,
      },
      postId
    );

    // 3. Fallback direct Mongo save if Kafka producer is offline
    if (!kafkaSent) {
      await saveCommentInMongo({
        postgresId: comment.id,
        tenantId,
        postId,
        authorId: userId,
        authorName: commentData.author,
        text: comment.text,
        createdAt: comment.createdAt,
      });
    }

    // 4. Emit real-time Socket.IO notification
    emitToTenant(tenantId, 'gallery_comment_added', {
      postId,
      comment: commentData,
    });

    res.status(201).json({ comment: commentData });
  } catch (err) {
    next(err);
  }
}

// DELETE /gallery/comments/:id
export async function deleteGalleryComment(req, res, next) {
  try {
    const tenantId = req.tenantId;
    const user = req.user;
    const { id } = req.params;

    const comment = await prisma.galleryComment.findFirst({ where: { id, tenantId } });
    if (!comment) return res.status(404).json({ error: 'Comment not found' });

    const privilegedRoles = ['HR', 'CMD', 'ADMIN', 'SUPER_ADMIN'];
    const isAuthor = comment.authorId === user.id;
    if (!isAuthor && !privilegedRoles.includes(user.role)) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    // 1. Delete from PostgreSQL
    await prisma.$transaction([
      prisma.galleryComment.delete({ where: { id } }),
      prisma.galleryPost.update({ where: { id: comment.postId }, data: { commentCount: { decrement: 1 } } }),
    ]);

    // 2. Publish event to Apache Kafka
    const kafkaSent = await publishKafkaEvent(
      env.kafkaTopicGallery,
      'GALLERY_COMMENT_DELETED',
      {
        commentId: id,
        tenantId,
        postId: comment.postId,
      },
      comment.postId
    );

    // 3. Fallback direct Mongo delete if Kafka is offline
    if (!kafkaSent) {
      await deleteCommentFromMongo({ postgresId: id, postId: comment.postId });
    }

    // 4. Emit real-time Socket.IO notification
    emitToTenant(tenantId, 'gallery_comment_deleted', {
      postId: comment.postId,
      commentId: id,
    });

    res.json({ message: 'Comment deleted', id });
  } catch (err) {
    next(err);
  }
}

// GET /gallery/categories
export async function getGalleryCategories(req, res) {
  res.json({ categories: ALLOWED_GALLERY_CATEGORIES });
}
