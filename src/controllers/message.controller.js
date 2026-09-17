import messageService from '../services/message.service.js';
import {
  sendMessageSchema,
  getMessagesQuerySchema,
  peerIdBodySchema,
  clearConversationSchema,
  messageIdParamSchema,
  formatIssues,
} from '../validations/message.schema.js';

// Every handler derives identity from req.user (set by requireAuth) — never
// from the request body or query string. Everything else is parsed with Zod
// before it reaches the service layer.
function fail(res, err) {
  const status = err?.status || 500;
  res.status(status).json({
    success: false,
    error: status === 500 ? 'Internal Server Error' : err.message,
  });
  if (status === 500) console.error('[Chat]', err);
}

function invalid(res, error) {
  res.status(400).json({
    success: false,
    error: 'Validation failed',
    details: formatIssues(error),
  });
}

export class MessageController {
  async getMessages(req, res) {
    try {
      const parsed = getMessagesQuerySchema.safeParse(req.query || {});
      if (!parsed.success) return invalid(res, parsed.error);

      const { id: userId, tenantId } = req.user;
      const { peerId, limit, before } = parsed.data;
      const result = await messageService.getConversation({ tenantId, userId, peerId, limit, before });

      // Opening a conversation implicitly acknowledges delivery of anything
      // still marked SENT for this reader.
      messageService
        .markDelivered({ tenantId, userId, conversationId: result.conversationId })
        .catch(() => {});

      res.status(200).json({
        success: true,
        conversationId: result.conversationId,
        source: result.source,
        data: result.messages,
      });
    } catch (err) {
      fail(res, err);
    }
  }

  async sendMessage(req, res) {
    try {
      const parsed = sendMessageSchema.safeParse(req.body || {});
      if (!parsed.success) return invalid(res, parsed.error);

      const { id: senderId, tenantId } = req.user;
      const { peerId, text, mediaUrl, mediaType, fileName, fileSize } = parsed.data;
      const message = await messageService.sendMessage({
        tenantId,
        senderId,
        peerId,
        text,
        mediaUrl,
        mediaType,
        fileName,
        fileSize,
      });
      res.status(201).json({ success: true, data: message });
    } catch (err) {
      fail(res, err);
    }
  }

  async markRead(req, res) {
    try {
      const parsed = peerIdBodySchema.safeParse(req.body || {});
      if (!parsed.success) return invalid(res, parsed.error);

      const { id: userId, tenantId } = req.user;
      const result = await messageService.markRead({ tenantId, userId, peerId: parsed.data.peerId });
      res.status(200).json({ success: true, ...result });
    } catch (err) {
      fail(res, err);
    }
  }

  // Inbox list for the Messages page. Takes no input beyond the session.
  async getConversations(req, res) {
    try {
      const { id: userId, tenantId } = req.user;
      const result = await messageService.getConversations({ tenantId, userId });
      res.status(200).json({ success: true, ...result });
    } catch (err) {
      fail(res, err);
    }
  }

  async getUnreadCounts(req, res) {
    try {
      const { id: userId, tenantId } = req.user;
      const result = await messageService.getUnreadCounts({ tenantId, userId });
      res.status(200).json({ success: true, ...result });
    } catch (err) {
      fail(res, err);
    }
  }

  async deleteForMe(req, res) {
    try {
      const parsed = messageIdParamSchema.safeParse(req.params || {});
      if (!parsed.success) return invalid(res, parsed.error);

      const { id: userId, tenantId } = req.user;
      const result = await messageService.deleteForMe({ tenantId, userId, messageId: parsed.data.id });
      res.status(200).json({ success: true, data: result });
    } catch (err) {
      fail(res, err);
    }
  }

  async deleteForEveryone(req, res) {
    try {
      const parsed = messageIdParamSchema.safeParse(req.params || {});
      if (!parsed.success) return invalid(res, parsed.error);

      const { id: userId, tenantId } = req.user;
      const result = await messageService.deleteForEveryone({ tenantId, userId, messageId: parsed.data.id });
      res.status(200).json({ success: true, data: result });
    } catch (err) {
      fail(res, err);
    }
  }

  // Clears the caller's own view of ONE conversation. There is deliberately no
  // endpoint that wipes messages globally.
  async clearConversation(req, res) {
    try {
      // The client may send peerId in the body or the query string.
      const parsed = clearConversationSchema.safeParse({
        ...(req.query || {}),
        ...(req.body || {}),
      });
      if (!parsed.success) return invalid(res, parsed.error);

      const { id: userId, tenantId } = req.user;
      const result = await messageService.clearConversation({ tenantId, userId, peerId: parsed.data.peerId });
      res.status(200).json({ success: true, ...result });
    } catch (err) {
      fail(res, err);
    }
  }
}

export default new MessageController();
