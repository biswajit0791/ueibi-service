import { prisma } from '../lib/prisma.js';
import { entityAttachmentService } from '../services/entityAttachment.service.js';
import { storageService } from '../services/storage/storage.service.js';
import { DisputeNotificationService } from '../services/disputeNotification.service.js';
import { isElevated } from '../lib/roles.js';
import {
  disputeIdParamSchema,
  disputeAttachmentParamSchema,
  disputeListQuerySchema,
  disputeCreateSchema,
  disputeUpdateSchema,
  disputeMessageCreateSchema,
} from '../validations/dispute.schema.js';

const ATTACHMENT_MIME_ALLOWLIST = new Set(['application/pdf', 'image/jpeg', 'image/png']);

const PERSON_SELECT = { id: true, name: true, email: true, designation: true };

const DISPUTE_INCLUDE = {
  raisedBy: { select: PERSON_SELECT },
  subjectEmployee: { select: PERSON_SELECT },
  assignedTo: { select: PERSON_SELECT },
};

/**
 * Loads a tenant-scoped dispute and enforces view access: elevated
 * (HR/Admin/CMD/Super Admin) see everything; everyone else only sees
 * tickets they raised or that are about them. Unauthorized access returns
 * 404 rather than 403 so ticket existence isn't leaked to outsiders.
 */
async function loadDisputeOrFail(req, res, id) {
  const dispute = await prisma.dispute.findFirst({
    where: { id, tenantId: req.tenantId },
    include: DISPUTE_INCLUDE,
  });
  if (!dispute) {
    res.status(404).json({ error: 'Dispute not found' });
    return null;
  }
  const allowed = isElevated(req.user.role) || dispute.raisedById === req.user.id || dispute.subjectEmployeeId === req.user.id;
  if (!allowed) {
    res.status(404).json({ error: 'Dispute not found' });
    return null;
  }
  return dispute;
}

/** Every user (raiser, subject employee, assignee) who should hear about
 * activity on a ticket, excluding a given actor and de-duplicated. */
function stakeholdersOf(dispute, excludeId) {
  const ids = new Set([dispute.raisedById, dispute.subjectEmployeeId, dispute.assignedToId].filter(Boolean));
  ids.delete(excludeId);
  return [...ids];
}

async function generateTicketNumber(tenantId) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const seq = (await prisma.dispute.count({ where: { tenantId } })) + 1001 + attempt;
    const ticketNumber = `TKT-${seq}`;
    const exists = await prisma.dispute.findUnique({ where: { ticketNumber }, select: { id: true } });
    if (!exists) return ticketNumber;
  }
  return `TKT-${Date.now().toString(36).toUpperCase()}`;
}

/**
 * GET /disputes — own tickets for regular employees, all tenant tickets for
 * HR/Admin/CMD/Super Admin, replacing DisputeCenter.jsx's unfiltered
 * localStorage array.
 */
export async function listDisputes(req, res, next) {
  try {
    const parsed = disputeListQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Validation failed', details: parsed.error.issues });
    }
    const { status, category, priority, search, page, limit } = parsed.data;

    const where = isElevated(req.user.role)
      ? { tenantId: req.tenantId }
      : { tenantId: req.tenantId, OR: [{ raisedById: req.user.id }, { subjectEmployeeId: req.user.id }] };

    if (status) where.status = status;
    if (priority) where.priority = priority;
    if (category) where.category = { equals: category, mode: 'insensitive' };
    if (search) {
      where.AND = [
        ...(where.AND || []),
        { OR: [
          { subject: { contains: search, mode: 'insensitive' } },
          { description: { contains: search, mode: 'insensitive' } },
          { ticketNumber: { contains: search, mode: 'insensitive' } },
        ] },
      ];
    }

    const skip = (page - 1) * limit;
    const [total, items] = await Promise.all([
      prisma.dispute.count({ where }),
      prisma.dispute.findMany({
        where,
        include: DISPUTE_INCLUDE,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
    ]);

    res.json({
      items,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) || 1 },
    });
  } catch (err) {
    next(err);
  }
}

/**
 * POST /disputes — any authenticated tenant user files a ticket. Regular
 * users can only target themselves as the subject employee; HR/Admin/CMD/
 * Super Admin may file on behalf of any tenant employee. Accepts an
 * optional first evidence file (multer memoryStorage, req.file).
 */
export async function createDispute(req, res, next) {
  try {
    const parsed = disputeCreateSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Validation failed', details: parsed.error.issues });
    }

    const elevated = isElevated(req.user.role);
    let subjectEmployeeId = req.user.id;
    if (elevated && parsed.data.subjectEmployeeId) {
      const subject = await prisma.tenantUser.findFirst({
        where: { id: parsed.data.subjectEmployeeId, tenantId: req.tenantId, isDeleted: false },
        select: { id: true },
      });
      if (!subject) {
        return res.status(400).json({ error: 'subjectEmployeeId does not refer to a valid employee in this tenant' });
      }
      subjectEmployeeId = subject.id;
    }

    if (req.file && !ATTACHMENT_MIME_ALLOWLIST.has(req.file.mimetype)) {
      return res.status(400).json({ error: 'Only PDF, JPEG, or PNG files are allowed' });
    }

    const ticketNumber = await generateTicketNumber(req.tenantId);

    const dispute = await prisma.dispute.create({
      data: {
        tenantId: req.tenantId,
        ticketNumber,
        subject: parsed.data.subject,
        description: parsed.data.description,
        category: parsed.data.category || 'Review Dispute',
        priority: parsed.data.priority || 'MEDIUM',
        raisedById: req.user.id,
        subjectEmployeeId,
      },
      include: DISPUTE_INCLUDE,
    });

    if (req.file) {
      await entityAttachmentService.save({
        tenantId: req.tenantId,
        entityType: 'DISPUTE',
        entityId: dispute.id,
        uploadedById: req.user.id,
        file: req.file,
      });
    }

    await DisputeNotificationService.notifyHrNewDispute({
      tenantId: req.tenantId,
      disputeId: dispute.id,
      ticketNumber: dispute.ticketNumber,
      subject: dispute.subject,
      raisedByName: req.user.name,
    });

    res.status(201).json({ dispute });
  } catch (err) {
    next(err);
  }
}

/** GET /disputes/:id — ticket detail + chat log + attachments. */
export async function getDisputeDetail(req, res, next) {
  try {
    const parsedParams = disputeIdParamSchema.safeParse(req.params);
    if (!parsedParams.success) {
      return res.status(400).json({ error: 'Invalid parameters', details: parsedParams.error.issues });
    }
    const { id } = parsedParams.data;

    const dispute = await loadDisputeOrFail(req, res, id);
    if (!dispute) return;

    const [messages, attachments] = await Promise.all([
      prisma.disputeMessage.findMany({
        where: { tenantId: req.tenantId, disputeId: id },
        include: { sender: { select: PERSON_SELECT } },
        orderBy: { createdAt: 'asc' },
      }),
      entityAttachmentService.list({ tenantId: req.tenantId, entityType: 'DISPUTE', entityId: id }),
    ]);

    res.json({
      dispute,
      messages,
      attachments: attachments.map((a) => ({ id: a.id, originalName: a.originalName, mimeType: a.mimeType, size: a.size })),
    });
  } catch (err) {
    next(err);
  }
}

/**
 * PATCH /disputes/:id — status/priority/assignment/resolution. HR/Admin/CMD/
 * Super Admin only, per the user's explicit RBAC decision — the raiser can
 * view and reply, but cannot close or reassign their own case.
 */
export async function updateDispute(req, res, next) {
  try {
    const parsedParams = disputeIdParamSchema.safeParse(req.params);
    if (!parsedParams.success) {
      return res.status(400).json({ error: 'Invalid parameters', details: parsedParams.error.issues });
    }
    if (!isElevated(req.user.role)) {
      return res.status(403).json({ error: 'Only HR/Admin can update a dispute ticket' });
    }
    const parsed = disputeUpdateSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Validation failed', details: parsed.error.issues });
    }
    const { id } = parsedParams.data;

    const existing = await prisma.dispute.findFirst({ where: { id, tenantId: req.tenantId } });
    if (!existing) {
      return res.status(404).json({ error: 'Dispute not found' });
    }

    const { status, priority, assignedToId, resolutionNotes } = parsed.data;
    if (assignedToId) {
      const assignee = await prisma.tenantUser.findFirst({
        where: { id: assignedToId, tenantId: req.tenantId, isDeleted: false },
        select: { id: true },
      });
      if (!assignee) {
        return res.status(400).json({ error: 'assignedToId does not refer to a valid employee in this tenant' });
      }
    }

    const dispute = await prisma.dispute.update({
      where: { id },
      data: {
        ...(status ? { status, resolvedAt: status === 'RESOLVED' ? new Date() : null } : {}),
        ...(priority ? { priority } : {}),
        ...(assignedToId !== undefined ? { assignedToId } : {}),
        ...(resolutionNotes !== undefined ? { resolutionNotes } : {}),
      },
      include: DISPUTE_INCLUDE,
    });

    if (status) {
      await DisputeNotificationService.notifyDisputeStatusChanged({
        tenantId: req.tenantId,
        disputeId: dispute.id,
        ticketNumber: dispute.ticketNumber,
        recipientIds: stakeholdersOf(dispute, req.user.id),
        status,
      });
    }

    res.json({ dispute });
  } catch (err) {
    next(err);
  }
}

/** POST /disputes/:id/messages — chat reply, from either side. */
export async function createDisputeMessage(req, res, next) {
  try {
    const parsedParams = disputeIdParamSchema.safeParse(req.params);
    if (!parsedParams.success) {
      return res.status(400).json({ error: 'Invalid parameters', details: parsedParams.error.issues });
    }
    const parsed = disputeMessageCreateSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Validation failed', details: parsed.error.issues });
    }
    const { id } = parsedParams.data;

    const dispute = await loadDisputeOrFail(req, res, id);
    if (!dispute) return;

    const message = await prisma.disputeMessage.create({
      data: {
        tenantId: req.tenantId,
        disputeId: id,
        senderId: req.user.id,
        body: parsed.data.body,
      },
      include: { sender: { select: PERSON_SELECT } },
    });

    await DisputeNotificationService.notifyDisputeReply({
      tenantId: req.tenantId,
      disputeId: dispute.id,
      ticketNumber: dispute.ticketNumber,
      recipientIds: stakeholdersOf(dispute, req.user.id),
      senderName: req.user.name,
    });

    res.status(201).json({ message });
  } catch (err) {
    next(err);
  }
}

/** POST /disputes/:id/attachment — attach supporting evidence to a ticket. */
export async function uploadDisputeAttachment(req, res, next) {
  try {
    const parsedParams = disputeIdParamSchema.safeParse(req.params);
    if (!parsedParams.success) {
      return res.status(400).json({ error: 'Invalid parameters', details: parsedParams.error.issues });
    }
    const { id } = parsedParams.data;
    if (!req.file) {
      return res.status(400).json({ error: 'A file is required' });
    }
    if (!ATTACHMENT_MIME_ALLOWLIST.has(req.file.mimetype)) {
      return res.status(400).json({ error: 'Only PDF, JPEG, or PNG files are allowed' });
    }

    const dispute = await loadDisputeOrFail(req, res, id);
    if (!dispute) return;

    const attachment = await entityAttachmentService.save({
      tenantId: req.tenantId,
      entityType: 'DISPUTE',
      entityId: id,
      uploadedById: req.user.id,
      file: req.file,
    });

    res.status(201).json({
      attachment: { id: attachment.id, originalName: attachment.originalName, mimeType: attachment.mimeType, size: attachment.size },
    });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    next(err);
  }
}

/** GET /disputes/:id/attachment/:attachmentId — protected download. */
export async function downloadDisputeAttachment(req, res, next) {
  try {
    const parsedParams = disputeAttachmentParamSchema.safeParse(req.params);
    if (!parsedParams.success) {
      return res.status(400).json({ error: 'Invalid parameters', details: parsedParams.error.issues });
    }
    const { id, attachmentId } = parsedParams.data;

    const dispute = await loadDisputeOrFail(req, res, id);
    if (!dispute) return;

    const attachment = await entityAttachmentService.getById({ tenantId: req.tenantId, id: attachmentId });
    if (!attachment || attachment.entityId !== id || attachment.entityType !== 'DISPUTE') {
      return res.status(404).json({ error: 'Attachment not found' });
    }

    const stream = await storageService.getDownloadStream(attachment.storageKey);
    const encodedFilename = encodeURIComponent(attachment.originalName);
    res.setHeader('Content-Type', attachment.mimeType || 'application/octet-stream');
    res.setHeader('Content-Disposition', `inline; filename="${encodedFilename}"; filename*=UTF-8''${encodedFilename}`);
    if (attachment.size) res.setHeader('Content-Length', attachment.size);
    stream.pipe(res);
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    next(err);
  }
}
