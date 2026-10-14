import { prisma } from '../lib/prisma.js';
import { emitToUser } from '../lib/socket.js';

export const FOLLOWER_ENTITY_TYPES = ['GOAL', 'TASK', 'CHECKPOINT'];

export class FollowerService {
  /**
   * List followers for a specific entity.
   */
  static async listFollowers({ tenantId, entityType, entityId }) {
    return prisma.follower.findMany({
      where: { tenantId, entityType: entityType.toUpperCase(), entityId },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            email: true,
            designation: true,
            department: true,
            role: true,
          },
        },
      },
      orderBy: { createdAt: 'asc' },
    });
  }

  /**
   * Add a follower to an entity.
   */
  static async addFollower({ tenantId, entityType, entityId, userId, addedById = null }) {
    const typeUpper = entityType.toUpperCase();
    if (!FOLLOWER_ENTITY_TYPES.includes(typeUpper)) {
      throw { status: 400, message: `Invalid entity type: ${entityType}. Must be one of: ${FOLLOWER_ENTITY_TYPES.join(', ')}` };
    }

    // Verify user belongs to tenant
    const targetUser = await prisma.tenantUser.findFirst({
      where: { id: userId, tenantId, isDeleted: false },
    });
    if (!targetUser) {
      throw { status: 404, message: 'User not found in this organization' };
    }

    const follower = await prisma.follower.upsert({
      where: {
        tenantId_entityType_entityId_userId: {
          tenantId,
          entityType: typeUpper,
          entityId,
          userId,
        },
      },
      create: {
        tenantId,
        entityType: typeUpper,
        entityId,
        userId,
      },
      update: {},
      include: {
        user: {
          select: {
            id: true,
            name: true,
            email: true,
            designation: true,
            department: true,
            role: true,
          },
        },
      },
    });

    // Notify user they are now following this entity
    if (addedById && addedById !== userId) {
      const notif = await prisma.notification.create({
        data: {
          tenantId,
          recipientId: userId,
          type: 'general',
          title: `Added as Follower`,
          body: `You were added as a follower on a ${typeUpper.toLowerCase()}. You will receive key delay alerts and progress updates.`,
          entityType: typeUpper.toLowerCase(),
          entityId,
        },
      }).catch(() => null);
      if (notif) emitToUser(tenantId, userId, 'notification', notif);
    }

    return follower;
  }

  /**
   * Remove a follower.
   */
  static async removeFollower({ tenantId, entityType, entityId, userId }) {
    const typeUpper = entityType.toUpperCase();
    return prisma.follower.deleteMany({
      where: {
        tenantId,
        entityType: typeUpper,
        entityId,
        userId,
      },
    });
  }

  /**
   * Get all follower user records for an entity.
   */
  static async getFollowerUsers(tenantId, entityType, entityId) {
    const followers = await prisma.follower.findMany({
      where: { tenantId, entityType: entityType.toUpperCase(), entityId },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            email: true,
            designation: true,
            role: true,
          },
        },
      },
    });
    return followers.map((f) => f.user).filter(Boolean);
  }
}
