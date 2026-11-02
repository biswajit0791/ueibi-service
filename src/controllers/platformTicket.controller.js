/**
 * platformTicket.controller.js — Cross-tenant support management for Platform Owner.
 */
import { prisma } from '../lib/prisma.js';

export async function listPlatformTickets(req, res, next) {
  try {
    const { status, priority, search } = req.query;
    const where = {};

    if (status && status !== 'ALL') where.status = status;
    if (priority && priority !== 'ALL') where.priority = priority;
    if (search) {
      where.OR = [
        { ticketNumber: { contains: search, mode: 'insensitive' } },
        { subject: { contains: search, mode: 'insensitive' } },
        { tenant: { companyName: { contains: search, mode: 'insensitive' } } },
      ];
    }

    const [total, tickets] = await Promise.all([
      prisma.platformTicket.count({ where }),
      prisma.platformTicket.findMany({
        where,
        include: {
          tenant: { select: { id: true, companyName: true, tenantCode: true } },
          createdBy: { select: { id: true, name: true, email: true } },
          assignedTo: { select: { id: true, name: true, email: true } },
          _count: { select: { messages: true } },
        },
        orderBy: { updatedAt: 'desc' },
      }),
    ]);

    // Statistics
    const [openCount, inProgressCount, resolvedCount] = await Promise.all([
      prisma.platformTicket.count({ where: { status: 'OPEN' } }),
      prisma.platformTicket.count({ where: { status: 'IN_PROGRESS' } }),
      prisma.platformTicket.count({ where: { status: 'RESOLVED' } }),
    ]);

    res.json({
      items: tickets,
      total,
      summary: {
        total,
        open: openCount,
        inProgress: inProgressCount,
        resolved: resolvedCount,
      },
    });
  } catch (err) {
    next(err);
  }
}

export async function getPlatformTicket(req, res, next) {
  try {
    const { id } = req.params;
    const ticket = await prisma.platformTicket.findUnique({
      where: { id },
      include: {
        tenant: true,
        createdBy: { select: { id: true, name: true, email: true } },
        assignedTo: { select: { id: true, name: true, email: true } },
        messages: {
          include: {
            sender: { select: { id: true, name: true, email: true, role: true } },
          },
          orderBy: { createdAt: 'asc' },
        },
      },
    });

    if (!ticket) return res.status(404).json({ error: 'Ticket not found' });
    res.json({ ticket });
  } catch (err) {
    next(err);
  }
}

export async function replyPlatformTicket(req, res, next) {
  try {
    const { id } = req.params;
    const { message, attachment } = req.body;

    if (!message || !message.trim()) {
      return res.status(400).json({ error: 'Message content cannot be blank' });
    }

    const ticket = await prisma.platformTicket.findUnique({ where: { id } });
    if (!ticket) return res.status(404).json({ error: 'Ticket not found' });

    const newMsg = await prisma.platformTicketMessage.create({
      data: {
        ticketId: id,
        senderId: req.user.id,
        isStaff: true,
        message: message.trim(),
        attachment: attachment || null,
      },
      include: {
        sender: { select: { id: true, name: true, email: true, role: true } },
      },
    });

    // Automatically set status to IN_PROGRESS if OPEN
    if (ticket.status === 'OPEN') {
      await prisma.platformTicket.update({
        where: { id },
        data: { status: 'IN_PROGRESS' },
      });
    }

    res.status(201).json({ message: newMsg });
  } catch (err) {
    next(err);
  }
}

export async function updatePlatformTicketStatus(req, res, next) {
  try {
    const { id } = req.params;
    const { status, priority, assignedToId } = req.body;

    const data = {};
    if (status) {
      data.status = status;
      if (status === 'RESOLVED') data.resolvedAt = new Date();
      if (status === 'CLOSED') data.closedAt = new Date();
    }
    if (priority) data.priority = priority;
    if (assignedToId !== undefined) data.assignedToId = assignedToId;

    const ticket = await prisma.platformTicket.update({
      where: { id },
      data,
    });

    res.json({ ticket });
  } catch (err) {
    next(err);
  }
}

