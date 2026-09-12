import mongoose from 'mongoose';

const galleryLikeSchema = new mongoose.Schema(
  {
    tenantId: { type: String, required: true, index: true },
    postId: { type: String, required: true, index: true },
    userId: { type: String, required: true, index: true },
    createdAt: { type: Date, default: Date.now },
  },
  {
    collection: 'gallery_likes',
    timestamps: false,
  }
);

galleryLikeSchema.index({ postId: 1, userId: 1 }, { unique: true });

const galleryCommentSchema = new mongoose.Schema(
  {
    postgresId: { type: String, index: true },
    tenantId: { type: String, required: true, index: true },
    postId: { type: String, required: true, index: true },
    authorId: { type: String, required: true, index: true },
    authorName: { type: String, default: 'Team Member' },
    text: { type: String, required: true, maxlength: 1000 },
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now },
  },
  {
    collection: 'gallery_comments',
    timestamps: true,
  }
);

galleryCommentSchema.index({ postId: 1, createdAt: 1 });

export const GalleryLikeMongo =
  mongoose.models.GalleryLike || mongoose.model('GalleryLike', galleryLikeSchema);

export const GalleryCommentMongo =
  mongoose.models.GalleryComment || mongoose.model('GalleryComment', galleryCommentSchema);
