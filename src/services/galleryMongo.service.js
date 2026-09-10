import { isMongoConnected } from '../lib/mongo.js';
import { GalleryLikeMongo, GalleryCommentMongo } from '../models/galleryMongo.model.js';

/**
 * Save like in MongoDB (upsert to avoid duplicates)
 */
export async function saveLikeInMongo({ tenantId, postId, userId }) {
  if (!isMongoConnected()) return false;
  try {
    await GalleryLikeMongo.updateOne(
      { postId, userId },
      { $setOnInsert: { tenantId, postId, userId, createdAt: new Date() } },
      { upsert: true }
    );
    return true;
  } catch (err) {
    console.warn(`[Mongo] Failed to save like: ${err.message}`);
    return false;
  }
}

/**
 * Remove like from MongoDB
 */
export async function removeLikeFromMongo({ postId, userId }) {
  if (!isMongoConnected()) return false;
  try {
    await GalleryLikeMongo.deleteOne({ postId, userId });
    return true;
  } catch (err) {
    console.warn(`[Mongo] Failed to remove like: ${err.message}`);
    return false;
  }
}

/**
 * Save comment in MongoDB
 */
export async function saveCommentInMongo({ postgresId, tenantId, postId, authorId, authorName, text, createdAt }) {
  if (!isMongoConnected()) return null;
  try {
    const comment = await GalleryCommentMongo.create({
      postgresId: postgresId ? String(postgresId) : undefined,
      tenantId,
      postId,
      authorId,
      authorName: authorName || 'Team Member',
      text,
      createdAt: createdAt ? new Date(createdAt) : new Date(),
      updatedAt: new Date(),
    });
    return comment;
  } catch (err) {
    console.warn(`[Mongo] Failed to save comment: ${err.message}`);
    return null;
  }
}

/**
 * Delete comment from MongoDB (by postgresId or mongo _id)
 */
export async function deleteCommentFromMongo({ postgresId, postId }) {
  if (!isMongoConnected()) return false;
  try {
    const filter = postgresId ? { postgresId: String(postgresId) } : { _id: postgresId };
    if (postId) filter.postId = postId;
    await GalleryCommentMongo.deleteOne(filter);
    return true;
  } catch (err) {
    console.warn(`[Mongo] Failed to delete comment: ${err.message}`);
    return false;
  }
}

/**
 * Query comments for a post directly from MongoDB
 */
export async function getCommentsFromMongo(postId) {
  if (!isMongoConnected()) return null;
  try {
    const docs = await GalleryCommentMongo.find({ postId }).sort({ createdAt: 1 }).lean();
    return docs.map((c) => ({
      id: c.postgresId || String(c._id),
      author: c.authorName || 'Team Member',
      authorId: c.authorId,
      text: c.text,
      createdAt: c.createdAt,
    }));
  } catch (err) {
    console.warn(`[Mongo] Failed to read comments for post ${postId}: ${err.message}`);
    return null;
  }
}

/**
 * Get like count and user liked status from MongoDB
 */
export async function getPostLikeStatsFromMongo(postId, userId) {
  if (!isMongoConnected()) return null;
  try {
    const [count, userLikeDoc] = await Promise.all([
      GalleryLikeMongo.countDocuments({ postId }),
      userId ? GalleryLikeMongo.findOne({ postId, userId }).lean() : null,
    ]);
    return {
      likeCount: count,
      userLiked: Boolean(userLikeDoc),
    };
  } catch (err) {
    console.warn(`[Mongo] Failed to get like stats for post ${postId}: ${err.message}`);
    return null;
  }
}

/**
 * Enrich an array of posts with likes, userLiked, and comment data read from MongoDB
 */
export async function enrichPostsWithMongoData(posts = [], userId) {
  if (!isMongoConnected() || posts.length === 0) {
    return posts;
  }

  try {
    const postIds = posts.map((p) => p.id);

    // Run parallel aggregation for like counts and user liked set
    const [likeCountsAgg, userLikesDocs, commentCountsAgg, recentCommentsDocs] = await Promise.all([
      GalleryLikeMongo.aggregate([
        { $match: { postId: { $in: postIds } } },
        { $group: { _id: '$postId', count: { $sum: 1 } } },
      ]),
      userId ? GalleryLikeMongo.find({ postId: { $in: postIds }, userId }).lean() : [],
      GalleryCommentMongo.aggregate([
        { $match: { postId: { $in: postIds } } },
        { $group: { _id: '$postId', count: { $sum: 1 } } },
      ]),
      GalleryCommentMongo.find({ postId: { $in: postIds } })
        .sort({ createdAt: 1 })
        .lean(),
    ]);

    const likeCountMap = new Map(likeCountsAgg.map((item) => [item._id, item.count]));
    const userLikedSet = new Set(userLikesDocs.map((item) => item.postId));
    const commentCountMap = new Map(commentCountsAgg.map((item) => [item._id, item.count]));

    const commentsByPostMap = new Map();
    for (const c of recentCommentsDocs) {
      if (!commentsByPostMap.has(c.postId)) {
        commentsByPostMap.set(c.postId, []);
      }
      commentsByPostMap.get(c.postId).push({
        id: c.postgresId || String(c._id),
        author: c.authorName || 'Team Member',
        authorId: c.authorId,
        text: c.text,
        createdAt: c.createdAt,
      });
    }

    return posts.map((p) => {
      const mongoLikes = likeCountMap.get(p.id);
      const mongoUserLiked = userLikedSet.has(p.id);
      const mongoCommentCount = commentCountMap.get(p.id);
      const mongoComments = commentsByPostMap.get(p.id);

      return {
        ...p,
        likeCount: mongoLikes !== undefined ? mongoLikes : p.likeCount,
        userLiked: userId ? (likeCountMap.has(p.id) ? mongoUserLiked : p.userLiked) : false,
        commentCount: mongoCommentCount !== undefined ? mongoCommentCount : p.commentCount,
        comments: mongoComments !== undefined ? mongoComments : p.comments,
      };
    });
  } catch (err) {
    console.warn(`[Mongo] Failed to enrich posts: ${err.message}`);
    return posts;
  }
}

/**
 * One-time synchronization from PostgreSQL to MongoDB on boot
 * Backfills any existing likes/comments if MongoDB collection is empty or behind.
 */
export async function syncFromPostgres(prisma) {
  if (!isMongoConnected() || !prisma) return;

  try {
    const mongoLikesCount = await GalleryLikeMongo.countDocuments();
    const mongoCommentsCount = await GalleryCommentMongo.countDocuments();

    // Check Postgres counts
    const [pgLikes, pgComments] = await Promise.all([
      prisma.galleryLike.findMany({ select: { tenantId: true, postId: true, userId: true, createdAt: true } }),
      prisma.galleryComment.findMany({
        include: { author: { select: { name: true } } },
      }),
    ]);

    if (mongoLikesCount === 0 && pgLikes.length > 0) {
      console.log(` [MongoDB] Backfilling ${pgLikes.length} existing likes from PostgreSQL...`);
      for (const l of pgLikes) {
        await GalleryLikeMongo.updateOne(
          { postId: l.postId, userId: l.userId },
          { $setOnInsert: { tenantId: l.tenantId, postId: l.postId, userId: l.userId, createdAt: l.createdAt } },
          { upsert: true }
        );
      }
    }

    if (mongoCommentsCount === 0 && pgComments.length > 0) {
      console.log(` [MongoDB] Backfilling ${pgComments.length} existing comments from PostgreSQL...`);
      for (const c of pgComments) {
        await GalleryCommentMongo.updateOne(
          { postgresId: c.id },
          {
            $setOnInsert: {
              postgresId: c.id,
              tenantId: c.tenantId,
              postId: c.postId,
              authorId: c.authorId,
              authorName: c.author?.name || 'Team Member',
              text: c.text,
              createdAt: c.createdAt,
            },
          },
          { upsert: true }
        );
      }
    }
  } catch (err) {
    console.warn(` [MongoDB] Notice: Backfill skipped (${err.message})`);
  }
}
