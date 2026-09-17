import messageService from './message.service.js';
import { emitToUser } from '../lib/socket.js';
import { conversationIdFor } from '../lib/conversation.js';
import {
  sendMessageSchema,
  peerIdBodySchema,
  socketDeleteSchema,
  socketTypingSchema,
  socketPresenceSchema,
  formatIssues,
} from '../validations/message.schema.js';

// In-process presence: tenantId -> Map(userId -> open socket count). A user may
// have several tabs open, so we refcount rather than store a boolean.
// NOTE: this is per-instance and correct for a single API node, which is how the
// service is deployed. Scaling to multiple nodes needs a shared presence store
// and a Socket.IO adapter — see "Known limits" in CHAT-FEATURE.md.
const presence = new Map();

function onlineUsers(tenantId) {
  const tenant = presence.get(tenantId);
  return tenant ? [...tenant.keys()] : [];
}

export function isUserOnline(tenantId, userId) {
  return Boolean(presence.get(tenantId)?.has(String(userId)));
}

function addPresence(tenantId, userId) {
  if (!presence.has(tenantId)) presence.set(tenantId, new Map());
  const tenant = presence.get(tenantId);
  const next = (tenant.get(userId) || 0) + 1;
  tenant.set(userId, next);
  return next === 1; // first connection => user just came online
}

function removePresence(tenantId, userId) {
  const tenant = presence.get(tenantId);
  if (!tenant) return false;
  const next = (tenant.get(userId) || 1) - 1;
  if (next <= 0) {
    tenant.delete(userId);
    if (tenant.size === 0) presence.delete(tenantId);
    return true; // last connection closed => user went offline
  }
  tenant.set(userId, next);
  return false;
}

// Socket.IO callbacks are optional on the client; guard before calling.
function respond(ack, value) {
  if (typeof ack === 'function') ack(value);
}

// Socket payloads are as untrusted as HTTP bodies, so every handler parses its
// input with the same Zod schemas the REST controllers use. Returns the parsed
// data, or null after having already answered the ack with the failure.
function parseOrReject(schema, data, ack, extra = {}) {
  const parsed = schema.safeParse(data ?? {});
  if (!parsed.success) {
    respond(ack, {
      ok: false,
      error: 'Validation failed',
      details: formatIssues(parsed.error),
      ...extra,
    });
    return null;
  }
  return parsed.data;
}

export function registerChatHandlers(socket, { tenantId, userId }) {
  const justCameOnline = addPresence(tenantId, userId);
  if (justCameOnline) {
    // Tell everyone currently connected in this tenant; scoped to per-user rooms
    // so nothing leaks past the tenant boundary.
    for (const peer of onlineUsers(tenantId)) {
      if (peer !== userId) emitToUser(tenantId, peer, 'chat:presence', { userId, online: true });
    }
  }

  // Let the freshly connected client know who is already online.
  socket.emit('chat:presence_snapshot', {
    online: onlineUsers(tenantId).filter((u) => u !== userId),
  });

  socket.on('chat:send', async (data = {}, ack) => {
    const clientId = data?.clientId ?? null;
    const input = parseOrReject(sendMessageSchema, data, ack, { clientId });
    if (!input) return;

    try {
      const message = await messageService.sendMessage({
        tenantId,
        senderId: userId, // never trusted from the payload
        peerId: input.peerId,
        text: input.text,
        mediaUrl: input.mediaUrl,
        mediaType: input.mediaType,
        fileName: input.fileName,
        fileSize: input.fileSize,
      });
      // `clientId` lets the sender reconcile its optimistic bubble with the
      // server-assigned id instead of rendering the message twice.
      respond(ack, { ok: true, message, clientId: input.clientId ?? null });
    } catch (err) {
      console.error('[Chat] send failed:', err.message);
      respond(ack, { ok: false, error: err.message, clientId });
    }
  });

  socket.on('chat:typing', (data = {}) => {
    // Fire-and-forget: no ack, so an invalid payload is simply dropped.
    const parsed = socketTypingSchema.safeParse(data ?? {});
    if (!parsed.success) return;
    const { peerId, typing } = parsed.data;
    if (peerId === userId) return;
    // Transient signal: not persisted, not routed through Kafka.
    emitToUser(tenantId, peerId, 'chat:typing', {
      conversationId: conversationIdFor(tenantId, userId, peerId),
      userId,
      typing,
    });
  });

  socket.on('chat:read', async (data = {}, ack) => {
    const input = parseOrReject(peerIdBodySchema, data, ack);
    if (!input) return;

    try {
      const result = await messageService.markRead({ tenantId, userId, peerId: input.peerId });
      respond(ack, { ok: true, ...result });
    } catch (err) {
      respond(ack, { ok: false, error: err.message });
    }
  });

  socket.on('chat:delete', async (data = {}, ack) => {
    const input = parseOrReject(socketDeleteSchema, data, ack);
    if (!input) return;

    try {
      const result =
        input.scope === 'everyone'
          ? await messageService.deleteForEveryone({ tenantId, userId, messageId: input.messageId })
          : await messageService.deleteForMe({ tenantId, userId, messageId: input.messageId });
      respond(ack, { ok: true, ...result });
    } catch (err) {
      respond(ack, { ok: false, error: err.message });
    }
  });

  socket.on('chat:clear', async (data = {}, ack) => {
    const input = parseOrReject(peerIdBodySchema, data, ack);
    if (!input) return;

    try {
      const result = await messageService.clearConversation({ tenantId, userId, peerId: input.peerId });
      respond(ack, { ok: true, ...result });
    } catch (err) {
      respond(ack, { ok: false, error: err.message });
    }
  });

  socket.on('chat:presence_check', (data = {}, ack) => {
    const input = parseOrReject(socketPresenceSchema, data, ack);
    if (!input) return;
    respond(ack, { online: isUserOnline(tenantId, input.peerId) });
  });
}

export function handleChatDisconnect({ tenantId, userId }) {
  const wentOffline = removePresence(tenantId, userId);
  if (wentOffline) {
    for (const peer of onlineUsers(tenantId)) {
      emitToUser(tenantId, peer, 'chat:presence', { userId, online: false });
    }
  }
}
