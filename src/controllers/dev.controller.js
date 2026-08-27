import { prisma } from '../lib/prisma.js';

export async function listNotifications(req, res, next) {
  try {
    const { email, registrationId, event } = req.query;
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
