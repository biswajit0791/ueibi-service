import { prisma } from '../lib/prisma.js';
import { listDevNotificationsQuerySchema } from '../validations/dev.schema.js';

export async function listNotifications(req, res, next) {
  try {
    const parsedQuery = listDevNotificationsQuerySchema.safeParse(req.query);
    if (!parsedQuery.success) {
      return res.status(400).json({ error: 'Validation failed', details: parsedQuery.error.issues });
    }
    const { email, registrationId, event } = parsedQuery.data;
    const where = {};
    if (registrationId) where.registrationId = registrationId;
    if (event) where.event = event;
    if (email) where.recipient = email;

    const items = await prisma.notificationLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    res.json({ items });
  } catch (err) {
    next(err);
  }
}
