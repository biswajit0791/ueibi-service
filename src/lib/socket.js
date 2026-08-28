import { Server } from 'socket.io';
import { env } from '../config/env.js';

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

  io.on('connection', (socket) => {
    console.log(`[Socket] Client connected: ${socket.id}`);
    
    // Join tenant broadcast room
    socket.on('join_tenant', (tenantId) => {
      if (tenantId) {
        socket.join(`tenant_${tenantId}`);
        console.log(`[Socket] Client ${socket.id} joined tenant_${tenantId}`);
      }
    });

    // Join personal notification room — called after login with { tenantId, userId }
    socket.on('join_user', ({ tenantId, userId }) => {
      if (tenantId && userId) {
        const room = `tenant:${tenantId}:user:${userId}`;
        socket.join(room);
        console.log(`[Socket] Client ${socket.id} joined ${room}`);
      }
    });

    socket.on('disconnect', () => {
      console.log(`[Socket] Client disconnected: ${socket.id}`);
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
