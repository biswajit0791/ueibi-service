import { prisma } from '../lib/prisma.js';

// ─── GET /api/notifications ──────────────────────────────────────────────────
export async function listNotifications(req, res, next) {
  try {
    const items = await prisma.notification.findMany({
      where: { recipientId: req.user.id, isRead: false },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    res.json({ items });
  } catch (err) {
    next(err);
  }
}

// ─── PATCH /api/notifications/:id/read ──────────────────────────────────────
export async function markRead(req, res, next) {
  try {
    const { id } = req.params;
    const notif = await prisma.notification.findUnique({ where: { id } });
    if (!notif) return res.status(404).json({ error: 'Notification not found' });
    if (notif.recipientId !== req.user.id) return res.status(403).json({ error: 'Access forbidden' });

    const updated = await prisma.notification.update({ where: { id }, data: { isRead: true } });
    res.json(updated);
  } catch (err) {
    next(err);
  }
}

// ─── PATCH /api/notifications/read-all ──────────────────────────────────────
export async function markAllRead(req, res, next) {
  try {
    await prisma.notification.updateMany({
      where: { recipientId: req.user.id, isRead: false },
      data: { isRead: true },
    });
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
}

// ─── DELETE /api/notifications/:id ──────────────────────────────────────────
export async function deleteNotification(req, res, next) {
  try {
    const { id } = req.params;
    const notif = await prisma.notification.findUnique({ where: { id } });
    if (!notif) return res.status(404).json({ error: 'Notification not found' });
    if (notif.recipientId !== req.user.id) return res.status(403).json({ error: 'Access forbidden' });

    await prisma.notification.delete({ where: { id } });
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
}
