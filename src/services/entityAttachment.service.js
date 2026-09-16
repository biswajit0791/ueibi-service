import { prisma } from '../lib/prisma.js';
import { storageService } from './storage/storage.service.js';

// Folder segments on disk are lowercase-kebab, decoupled from the Prisma
// enum's uppercase values so a schema rename never silently changes paths.
const ENTITY_FOLDER = {
  TRAINING_RECORD: 'training-records',
  ACHIEVEMENT: 'achievements',
  INCIDENT: 'incidents',
  DISPUTE: 'disputes',
};

export const entityAttachmentService = {
  /**
   * Saves a file to disk and records its metadata. Cleans up the physical
   * file if the DB insert fails, mirroring comment.service.js's pattern.
   */
  async save({ tenantId, entityType, entityId, uploadedById, file }) {
    const folder = ENTITY_FOLDER[entityType];
    if (!folder) {
      throw { status: 400, message: `Unknown attachment entity type: ${entityType}` };
    }

    const saved = await storageService.save({
      tenantId,
      entityType: folder,
      entityId,
      buffer: file.buffer,
      originalName: file.originalname,
      mimeType: file.mimetype,
      size: file.size,
    });

    try {
      return await prisma.entityAttachment.create({
        data: {
          tenantId,
          entityType,
          entityId,
          uploadedById,
          originalName: saved.originalName,
          storedName: saved.storedName,
          mimeType: saved.mimeType,
          size: saved.size,
          storageKey: saved.storageKey,
        },
      });
    } catch (dbErr) {
      await storageService.delete(saved.storageKey).catch(() => {});
      throw dbErr;
    }
  },

  async list({ tenantId, entityType, entityId }) {
    return prisma.entityAttachment.findMany({
      where: { tenantId, entityType, entityId },
      orderBy: { createdAt: 'desc' },
    });
  },

  async getById({ tenantId, id }) {
    return prisma.entityAttachment.findFirst({ where: { id, tenantId } });
  },

  async delete({ tenantId, id }) {
    const attachment = await prisma.entityAttachment.findFirst({ where: { id, tenantId } });
    if (!attachment) return false;
    await storageService.delete(attachment.storageKey).catch(() => {});
    await prisma.entityAttachment.delete({ where: { id } });
    return true;
  },
};
