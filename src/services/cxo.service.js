import { prisma } from '../lib/prisma.js';
import { isLeadership, hasCapability, listCapabilityHolders, CAPABILITIES } from '../lib/capabilities.js';
import { emitToUser } from '../lib/socket.js';

// Business days the SLA promise in the UI is based on ("responds within 5
// business days"). Kept here so the copy and the data agree.
const SLA_BUSINESS_DAYS = 5;

function addBusinessDays(from, days) {
  const d = new Date(from);
  let added = 0;
  while (added < days) {
    d.setDate(d.getDate() + 1);
    const day = d.getDay();
    if (day !== 0 && day !== 6) added += 1;
  }
  return d;
}

async function nextTicketNumber(tenantId) {
  const year = new Date().getFullYear();
  const count = await prisma.cxoMessage.count({ where: { tenantId } });
  return `CXO-${year}-${String(count + 1).padStart(4, '0')}`;
}

/**
 * Shape a message for the wire.
 *
 * ANONYMITY: when `isAnonymous` is set, the sender is stripped for every viewer
 * except the sender themselves. `raisedById` stays in the database so abuse can
 * be investigated and so the employee can follow their own thread — but it
 * never crosses this boundary. There is deliberately no role, including
 * SUPER_ADMIN, that can unmask a sender through the API.
 */
function toWire(msg, viewerId) {
  if (!msg) return null;
  const isOwn = msg.raisedById === viewerId;
  const hideSender = msg.isAnonymous && !isOwn;

  return {
    id: msg.id,
    ticketNumber: msg.ticketNumber,
    subject: msg.subject,
    body: msg.body,
    category: msg.category,
    status: msg.status,
    isAnonymous: msg.isAnonymous,
    isMine: isOwn,
    from: hideSender
      ? { id: null, name: 'Anonymous', designation: null, department: null }
      : {
          id: msg.raisedBy?.id ?? msg.raisedById,
          name: msg.raisedBy?.name ?? null,
          designation: msg.raisedBy?.designation ?? null,
          department: msg.raisedBy?.department ?? null,
        },
    targetLeader: msg.targetLeader
      ? { id: msg.targetLeader.id, name: msg.targetLeader.name, designation: msg.targetLeader.designation }
      : null,
    assignedTo: msg.assignedTo
      ? { id: msg.assignedTo.id, name: msg.assignedTo.name }
      : null,
    dueAt: msg.dueAt,
    isOverdue: Boolean(
      msg.dueAt && msg.status !== 'CLOSED' && msg.status !== 'REPLIED' && new Date(msg.dueAt) < new Date(),
    ),
    closedAt: msg.closedAt,
    lastReplyAt: msg.lastReplyAt,
    createdAt: msg.createdAt,
    replyCount: msg._count?.replies ?? msg.replies?.length ?? 0,
    replies: Array.isArray(msg.replies)
      ? msg.replies.map((r) => toWireReply(r, viewerId, msg))
      : undefined,
  };
}

function toWireReply(reply, viewerId, msg) {
  // An employee's follow-up on their own anonymous thread stays anonymous too,
  // otherwise the first reply would unmask them.
  const hide = msg?.isAnonymous && !reply.isLeadershipResponse && reply.authorId !== viewerId;
  return {
    id: reply.id,
    body: reply.body,
    isLeadershipResponse: reply.isLeadershipResponse,
    author: hide
      ? { id: null, name: 'Anonymous' }
      : { id: reply.author?.id ?? reply.authorId, name: reply.author?.name ?? null },
    isMine: reply.authorId === viewerId,
    createdAt: reply.createdAt,
  };
}

const senderSelect = { select: { id: true, name: true, designation: true, department: true } };
const leaderSelect = { select: { id: true, name: true, designation: true } };

export class CxoService {
  /** Leaders an employee can address. */
  async listLeaders(tenantId) {
    return listCapabilityHolders(tenantId, CAPABILITIES.LEADERSHIP);
  }

  async createMessage({ tenantId, raisedById, subject, body, category, isAnonymous, targetLeaderId }) {
    if (targetLeaderId) {
      // The target must actually hold the capability — otherwise a message
      // could be addressed to anyone and would never appear in an inbox.
      const leader = await prisma.userCapability.findFirst({
        where: { tenantId, userId: targetLeaderId, capability: CAPABILITIES.LEADERSHIP },
        select: { userId: true },
      });
      if (!leader) {
        throw Object.assign(new Error('That recipient is not on the leadership panel'), { status: 400 });
      }
      if (targetLeaderId === raisedById) {
        throw Object.assign(new Error('You cannot send a message to yourself'), { status: 400 });
      }
    }

    const created = await prisma.cxoMessage.create({
      data: {
        tenantId,
        ticketNumber: await nextTicketNumber(tenantId),
        subject,
        body,
        category,
        isAnonymous: Boolean(isAnonymous),
        raisedById,
        targetLeaderId: targetLeaderId ?? null,
        assignedToId: targetLeaderId ?? null,
        dueAt: addBusinessDays(new Date(), SLA_BUSINESS_DAYS),
      },
      include: { raisedBy: senderSelect, targetLeader: leaderSelect, assignedTo: leaderSelect },
    });

    // Notify the addressed leader, or the whole panel when unaddressed.
    const recipients = targetLeaderId
      ? [targetLeaderId]
      : (await this.listLeaders(tenantId)).map((l) => l.id);
    for (const userId of recipients) {
      if (userId !== raisedById) {
        emitToUser(tenantId, userId, 'cxo:message', toWire(created, userId));
      }
    }

    return toWire(created, raisedById);
  }

  /**
   * Employee view: only their own messages.
   * Leadership view: everything addressed to them, plus anything unaddressed.
   */
  async listMessages({ tenantId, user, status, category, scope }) {
    const leadership = isLeadership(user);
    const asLeader = leadership && scope !== 'mine';

    const where = { tenantId };
    if (status) where.status = status;
    if (category) where.category = category;

    if (asLeader) {
      where.OR = [{ targetLeaderId: user.id }, { targetLeaderId: null }, { assignedToId: user.id }];
    } else {
      where.raisedById = user.id;
    }

    const rows = await prisma.cxoMessage.findMany({
      where,
      include: {
        raisedBy: senderSelect,
        targetLeader: leaderSelect,
        assignedTo: leaderSelect,
        _count: { select: { replies: true } },
      },
      orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
      take: 200,
    });

    // An elevated role (ADMIN/SUPER_ADMIN/HR/CMD) gets the leadership VIEW so
    // there is no bootstrapping dead end, but the inbox only contains messages
    // addressed or assigned to them. Someone not on the panel therefore sees an
    // empty list — report that explicitly so the UI can explain why rather than
    // showing a bare "No messages yet".
    const onPanel = hasCapability(user, CAPABILITIES.LEADERSHIP);

    return {
      scope: asLeader ? 'leadership' : 'mine',
      onPanel,
      messages: rows.map((m) => toWire(m, user.id)),
    };
  }

  async getMessage({ tenantId, user, id }) {
    const msg = await prisma.cxoMessage.findFirst({
      where: { id, tenantId },
      include: {
        raisedBy: senderSelect,
        targetLeader: leaderSelect,
        assignedTo: leaderSelect,
        replies: {
          orderBy: { createdAt: 'asc' },
          include: { author: { select: { id: true, name: true } } },
        },
      },
    });
    if (!msg) throw Object.assign(new Error('Message not found'), { status: 404 });

    const isOwner = msg.raisedById === user.id;
    if (!isOwner && !isLeadership(user)) {
      throw Object.assign(new Error('You do not have access to this message'), { status: 403 });
    }

    // Mark read for whichever side is looking.
    const field = isOwner ? 'readByEmployeeAt' : 'readByLeadershipAt';
    if (!msg[field]) {
      prisma.cxoMessage.update({ where: { id }, data: { [field]: new Date() } }).catch(() => {});
    }

    return toWire(msg, user.id);
  }

  async addReply({ tenantId, user, id, body }) {
    const msg = await prisma.cxoMessage.findFirst({
      where: { id, tenantId },
      select: { id: true, raisedById: true, status: true, isAnonymous: true, targetLeaderId: true, assignedToId: true },
    });
    if (!msg) throw Object.assign(new Error('Message not found'), { status: 404 });

    const isOwner = msg.raisedById === user.id;
    const asLeader = isLeadership(user);
    if (!isOwner && !asLeader) {
      throw Object.assign(new Error('You do not have access to this message'), { status: 403 });
    }
    if (msg.status === 'CLOSED') {
      throw Object.assign(new Error('This message is closed'), { status: 400 });
    }

    // A leader replying to their own thread is an employee follow-up, not an
    // official response — decided by ownership first, capability second.
    const isLeadershipResponse = !isOwner && asLeader;

    const [reply] = await prisma.$transaction([
      prisma.cxoMessageReply.create({
        data: { tenantId, messageId: id, authorId: user.id, body, isLeadershipResponse },
        include: { author: { select: { id: true, name: true } } },
      }),
      prisma.cxoMessage.update({
        where: { id },
        data: {
          lastReplyAt: new Date(),
          // Only an official response moves the ticket to REPLIED.
          ...(isLeadershipResponse
            ? { status: 'REPLIED', assignedToId: msg.assignedToId ?? user.id, readByEmployeeAt: null }
            : { readByLeadershipAt: null }),
        },
      }),
    ]);

    const wire = toWireReply(reply, user.id, msg);

    // Tell the other side. The employee is always notified on their own thread,
    // even anonymous ones — they are identified to the server, just not to
    // leadership.
    const others = isLeadershipResponse
      ? [msg.raisedById]
      : [msg.assignedToId, msg.targetLeaderId].filter(Boolean);
    for (const userId of new Set(others)) {
      if (userId !== user.id) {
        emitToUser(tenantId, userId, 'cxo:reply', { messageId: id, reply: toWireReply(reply, userId, msg) });
      }
    }

    return wire;
  }

  /** Leadership-only: assign, change status, acknowledge, close. */
  async updateMessage({ tenantId, user, id, status, assignedToId }) {
    if (!isLeadership(user)) {
      throw Object.assign(new Error('Only leadership can update a message'), { status: 403 });
    }
    const msg = await prisma.cxoMessage.findFirst({ where: { id, tenantId }, select: { id: true, raisedById: true } });
    if (!msg) throw Object.assign(new Error('Message not found'), { status: 404 });

    if (assignedToId) {
      const leader = await prisma.userCapability.findFirst({
        where: { tenantId, userId: assignedToId, capability: CAPABILITIES.LEADERSHIP },
        select: { userId: true },
      });
      if (!leader) {
        throw Object.assign(new Error('Can only assign to someone on the leadership panel'), { status: 400 });
      }
    }

    const updated = await prisma.cxoMessage.update({
      where: { id },
      data: {
        ...(status ? { status, ...(status === 'CLOSED' ? { closedAt: new Date() } : {}) } : {}),
        ...(assignedToId ? { assignedToId } : {}),
      },
      include: { raisedBy: senderSelect, targetLeader: leaderSelect, assignedTo: leaderSelect },
    });

    emitToUser(tenantId, msg.raisedById, 'cxo:updated', toWire(updated, msg.raisedById));
    return toWire(updated, user.id);
  }

  /** Counts for the nav badge. */
  async getStats({ tenantId, user }) {
    if (isLeadership(user)) {
      const [open, overdue, unread] = await Promise.all([
        prisma.cxoMessage.count({
          where: { tenantId, status: { in: ['PENDING', 'ACKNOWLEDGED'] }, OR: [{ targetLeaderId: user.id }, { targetLeaderId: null }, { assignedToId: user.id }] },
        }),
        prisma.cxoMessage.count({
          where: { tenantId, status: { in: ['PENDING', 'ACKNOWLEDGED'] }, dueAt: { lt: new Date() }, OR: [{ targetLeaderId: user.id }, { targetLeaderId: null }, { assignedToId: user.id }] },
        }),
        prisma.cxoMessage.count({
          where: { tenantId, readByLeadershipAt: null, OR: [{ targetLeaderId: user.id }, { targetLeaderId: null }, { assignedToId: user.id }] },
        }),
      ]);
      return { scope: 'leadership', onPanel: hasCapability(user, CAPABILITIES.LEADERSHIP), open, overdue, unread };
    }

    const [open, unread] = await Promise.all([
      prisma.cxoMessage.count({ where: { tenantId, raisedById: user.id, status: { not: 'CLOSED' } } }),
      prisma.cxoMessage.count({ where: { tenantId, raisedById: user.id, readByEmployeeAt: null, status: 'REPLIED' } }),
    ]);
    return { scope: 'mine', onPanel: false, open, overdue: 0, unread };
  }
}

export default new CxoService();
