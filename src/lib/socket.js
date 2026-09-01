import { Server } from 'socket.io';
import { env } from '../config/env.js';
import { verifyToken } from './jwt.js';
import { parseCookies } from './adminAuth.js';

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

    socket.on('disconnect', () => {
      // Disconnected
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

