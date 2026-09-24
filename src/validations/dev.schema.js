import { z } from 'zod';

/**
 * GET /dev/notifications.
 *
 * Platform-owner-only debug view over the notification log. The filters went
 * straight into a Prisma `where` unchecked; bounding them keeps the shape of
 * the query predictable and matches every other route in the service.
 */
export const listDevNotificationsQuerySchema = z.object({
  email: z.string().max(200).optional(),
  registrationId: z.string().max(100).optional(),
  event: z.string().max(100).optional(),
}).passthrough();
