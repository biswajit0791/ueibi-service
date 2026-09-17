import { z } from 'zod';

// Server-side validation for every chat entry point — both the REST controllers
// and the Socket.IO handlers. Socket payloads are just as untrusted as HTTP
// bodies, so they are parsed with the same schemas.
//
// NOTE on syntax: this project runs Zod 4, where the v3 `required_error` option
// is ignored. Custom messages use `{ error: '...' }`.

const MAX_TEXT_LENGTH = 4000;

const userId = z
  .string({ error: 'peerId is required' })
  .trim()
  .min(1, 'peerId cannot be empty')
  .max(100, 'peerId is too long');

// Attachments are produced by our own upload endpoints, which return a
// /uploads/... path. Absolute URLs are accepted because the frontend prefixes
// the API origin before sending them back.
const mediaUrl = z
  .string()
  .trim()
  .max(2000, 'mediaUrl is too long')
  .refine(
    (url) =>
      url.startsWith('/uploads/') ||
      url.startsWith('/api/uploads/') ||
      url.startsWith('http://') ||
      url.startsWith('https://'),
    'mediaUrl must be an uploaded file path or an http(s) URL',
  )
  .nullish();

const mediaFields = {
  mediaUrl,
  mediaType: z.string().trim().max(150, 'mediaType is too long').nullish(),
  fileName: z.string().trim().max(255, 'fileName is too long').nullish(),
  fileSize: z.coerce
    .number()
    .int('fileSize must be a whole number')
    .nonnegative('fileSize cannot be negative')
    .max(52428800, 'fileSize exceeds the 50MB limit')
    .nullish(),
};

// A message must carry text, an attachment, or both — never nothing.
const hasContent = (data) => Boolean((data.text && data.text.length > 0) || data.mediaUrl);
const contentMessage = { message: 'Message text or media is required', path: ['text'] };

// POST /api/messages  and  socket "chat:send"
export const sendMessageSchema = z
  .object({
    peerId: userId,
    // The socket client historically sent `msg`; accept both, normalise to text.
    text: z.string().trim().max(MAX_TEXT_LENGTH, `Message cannot exceed ${MAX_TEXT_LENGTH} characters`).optional(),
    msg: z.string().trim().max(MAX_TEXT_LENGTH, `Message cannot exceed ${MAX_TEXT_LENGTH} characters`).optional(),
    clientId: z.string().trim().max(100, 'clientId is too long').nullish(),
    ...mediaFields,
  })
  .transform((data) => ({ ...data, text: data.text ?? data.msg ?? '' }))
  .refine(hasContent, contentMessage);

// GET /api/messages
export const getMessagesQuerySchema = z.object({
  peerId: userId,
  limit: z.coerce
    .number()
    .int('limit must be a whole number')
    .min(1, 'limit must be at least 1')
    .max(200, 'limit cannot exceed 200')
    .optional()
    .default(100),
  before: z.coerce
    .date({ error: 'before must be a valid ISO date' })
    .optional(),
});

// POST /api/messages/read  and  socket "chat:read"
export const peerIdBodySchema = z.object({ peerId: userId });

// DELETE /api/messages/clear — the frontend may send peerId in the body or the
// query string, so the controller merges both before parsing.
export const clearConversationSchema = z.object({ peerId: userId });

// DELETE /api/messages/:id/me  and  /api/messages/:id/everyone
export const messageIdParamSchema = z.object({
  id: z
    .string({ error: 'Message ID parameter is required' })
    .trim()
    .min(1, 'Message ID cannot be empty')
    .max(100, 'Message ID is too long'),
});

// socket "chat:delete"
export const socketDeleteSchema = z.object({
  messageId: z
    .string({ error: 'messageId is required' })
    .trim()
    .min(1, 'messageId cannot be empty')
    .max(100, 'messageId is too long'),
  scope: z.enum(['me', 'everyone'], { error: "scope must be 'me' or 'everyone'" }).default('me'),
});

// socket "chat:typing"
export const socketTypingSchema = z.object({
  peerId: userId,
  typing: z.coerce.boolean().default(false),
});

// socket "chat:presence_check"
export const socketPresenceSchema = z.object({ peerId: userId });

/**
 * Flattens Zod issues into the `{ field, message }` shape the API already
 * returns elsewhere for validation failures.
 */
export function formatIssues(error) {
  const issues = error?.issues || [];
  return issues.map((i) => ({
    field: Array.isArray(i.path) ? i.path.join('.') : String(i.path ?? ''),
    message: i.message,
  }));
}
