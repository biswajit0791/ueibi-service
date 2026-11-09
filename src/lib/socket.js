import { Server } from 'socket.io';
import { env } from '../config/env.js';
import { verifyToken } from './jwt.js';
import { parseCookies } from './cookies.js';
import { prisma } from './prisma.js';
import { registerChatHandlers, handleChatDisconnect } from '../services/chatSocket.service.js';

let io;

export function getIO() {
  return io;
}

export function initSocket(server) {
  io = new Server(server, {
    cors: {
      origin: env.corsOrigin || 'http://localhost:5173',
      credentials: true,
    },
  });

  // Socket.IO JWT Authentication Middleware
  io.use((socket, next) => {
    let token = socket.handshake.auth?.token;

    if (!token && socket.handshake.headers?.authorization) {
      const authHeader = socket.handshake.headers.authorization;
      if (authHeader.startsWith('Bearer ')) {
        token = authHeader.substring(7);
      }
    }

    if (!token && socket.handshake.headers?.cookie) {
      const cookies = parseCookies(socket.handshake.headers.cookie);
      token = cookies['ueibi_session'];
    }

    if (!token) {
      return next(new Error('Authentication error: Token required'));
    }

    const decoded = verifyToken(token);
    if (!decoded || !decoded.userId || !decoded.tenantId) {
      return next(new Error('Authentication error: Invalid or expired token'));
    }

    socket.user = decoded;
    next();
  });

  io.on('connection', (socket) => {
    const authTenantId = socket.user.tenantId;
    const authUserId = socket.user.userId;

    // Automatically join the authenticated user's tenant & personal rooms
    socket.join(`tenant_${authTenantId}`);
    socket.join(`tenant:${authTenantId}:user:${authUserId}`);

    // Explicit room join handlers (strictly validating against authenticated identity)
    socket.on('join_tenant', (tenantId) => {
      if (tenantId === authTenantId) {
        socket.join(`tenant_${tenantId}`);
      } else {
        console.warn(`[Socket] Unauthorized join_tenant attempt by ${authUserId} for tenant ${tenantId}`);
      }
    });

    socket.on('join_user', ({ tenantId, userId }) => {
      if (tenantId === authTenantId && userId === authUserId) {
        socket.join(`tenant:${tenantId}:user:${userId}`);
      } else {
        console.warn(`[Socket] Unauthorized join_user attempt by ${authUserId} for user ${userId}`);
      }
    });

    // Secure Goal Room Management
    // Validate tenant isolation and user authorization against database before joining
    socket.on('join_goal', async (goalId) => {
      if (!goalId || typeof goalId !== 'string') return;
      try {
        const goal = await prisma.goal.findFirst({
          where: { id: goalId, tenantId: authTenantId },
          include: {
            assignments: { select: { employeeId: true } },
            employee: { select: { id: true, managerId: true } },
          },
        });
        if (!goal) return;

        const isElevated = ['SUPER_ADMIN', 'ADMIN', 'HR', 'CMD'].includes(socket.user.role);
        const isAssignee = goal.employeeId === authUserId || goal.assignments?.some((a) => a.employeeId === authUserId);
        const isOwner = goal.ownerManagerId === authUserId;
        const isCreator = goal.createdById === authUserId;
        const isManager = goal.employee?.managerId === authUserId;

        if (isElevated || isAssignee || isOwner || isCreator || isManager) {
          socket.join(`tenant:${authTenantId}:goal:${goalId}`);
        } else {
          console.warn(`[Socket] Unauthorized join_goal attempt by ${authUserId} for goal ${goalId}`);
        }
      } catch (err) {
        console.error('[Socket] join_goal error:', err.message);
      }
    });

    socket.on('leave_goal', (goalId) => {
      if (goalId && typeof goalId === 'string') {
        socket.leave(`tenant:${authTenantId}:goal:${goalId}`);
      }
    });

    registerChatHandlers(socket, { tenantId: authTenantId, userId: authUserId });

    socket.on('disconnect', () => {
      handleChatDisconnect({ tenantId: authTenantId, userId: authUserId });
    });
  });

  return io;
}

export function emitToTenant(tenantId, event, payload) {
  if (io && tenantId) {
    io.to(`tenant_${tenantId}`).emit(event, payload);
  }
}

export function emitToUser(tenantId, userId, event, payload) {
  if (io && tenantId && userId) {
    io.to(`tenant:${tenantId}:user:${userId}`).emit(event, payload);
  }
}

/**
 * Broadcast Goal Event securely to authorized users, goal room, and tenant room.
 *
 * Emits typed events ('goal:approved', 'goal:rejected', 'goal:updated')
 * as well as legacy 'goal_updated' for complete backward compatibility.
 *
 * @param {string} tenantId
 * @param {string} eventName - e.g. 'goal:approved', 'goal:rejected', 'goal:updated'
 * @param {object} payload - structured event data including goalId, status, employeeId, etc.
 * @param {string[]} authorizedUserIds - array of user IDs associated with this goal
 * @param {string} [goalId] - optional goal ID to also broadcast to active goal room subscribers
 */
export function emitGoalEvent(tenantId, eventName, payload, authorizedUserIds = [], goalId = null) {
  if (!io || !tenantId) return;

  let broadcaster = io.to(`tenant_${tenantId}`);

  if (Array.isArray(authorizedUserIds)) {
    for (const userId of authorizedUserIds) {
      if (userId) {
        broadcaster = broadcaster.to(`tenant:${tenantId}:user:${userId}`);
      }
    }
  }

  if (goalId) {
    broadcaster = broadcaster.to(`tenant:${tenantId}:goal:${goalId}`);
  }

  // 1. Emit primary event (e.g. 'goal:approved', 'goal:rejected', or 'goal:updated')
  broadcaster.emit(eventName, payload);

  // 2. Also emit 'goal:updated' if primary event was approved or rejected
  if (eventName !== 'goal:updated') {
    broadcaster.emit('goal:updated', payload);
  }

  // 3. Emit legacy 'goal_updated' event for backward compatibility
  broadcaster.emit('goal_updated', {
    action: payload.action || 'update',
    goalId: payload.goalId || payload.id,
    goal: payload.goal || payload,
  });
}

/**
 * Broadcast Task Dependency event to tenant and specific recipient user rooms.
 *
 * Supported events:
 * - dependency:created
 * - dependency:approval-requested
 * - dependency:approved
 * - dependency:rejected
 * - dependency:assigned
 * - dependency:unlocked
 * - dependency:verification-requested
 * - dependency:verified
 * - dependency:blocked
 * - dependency:rework-requested
 *
 * Also emits legacy 'task_updated' for backward compatibility.
 */
export function emitDependencyEvent(tenantId, eventName, payload, recipientUserIds = []) {
  if (!io || !tenantId) return;

  let broadcaster = io.to(`tenant_${tenantId}`);

  if (Array.isArray(recipientUserIds)) {
    for (const userId of recipientUserIds) {
      if (userId) {
        broadcaster = broadcaster.to(`tenant:${tenantId}:user:${userId}`);
      }
    }
  }

  // 1. Emit typed dependency event
  broadcaster.emit(eventName, payload);

  // 2. Also emit legacy task_updated for components still listening to it
  broadcaster.emit('task_updated', {
    action: eventName,
    taskId: payload.sourceTaskId || payload.taskId,
    dependencyId: payload.id || payload.dependencyId,
    status: payload.status,
  });
}



