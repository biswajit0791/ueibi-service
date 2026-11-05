/**
 * exitDispatch.service.js
 * Comprehensive tracking, audit trail, duplicate prevention and history retrieval
 * for employee exit separation documents dispatched via email.
 */
import { prisma } from '../lib/prisma.js';

// In-memory locks with 20s TTL to prevent concurrent double-click dispatches
const activeDispatches = new Map();

export function acquireDispatchLock(exitId, recipientEmail) {
  const key = `${exitId}:${(recipientEmail || '').toLowerCase().trim()}`;
  const now = Date.now();
  const existing = activeDispatches.get(key);
  if (existing && (now - existing < 20000)) {
    return false; // lock held within 20s TTL
  }
  activeDispatches.set(key, now);
  return true;
}

export function releaseDispatchLock(exitId, recipientEmail) {
  const key = `${exitId}:${(recipientEmail || '').toLowerCase().trim()}`;
  activeDispatches.delete(key);
}

/**
 * Builds the per-document status and dispatch summary for an exit record.
 * @param {string} exitDetailsId
 * @param {object} exitRecord - ExitDetails record with relievingLetterUrl, serviceCertificateUrl, etc.
 */
export async function getExitDocumentStatuses(exitDetailsId, exitRecord) {
  const dispatches = await prisma.exitDocumentDispatch.findMany({
    where: { exitDetailsId },
    orderBy: { sentAt: 'desc' },
  });

  const remarksObj = (() => {
    try {
      return JSON.parse(exitRecord.feedbackRemarks || '{}');
    } catch {
      return {};
    }
  })();

  const docDefs = [
    {
      type: 'relieving',
      name: 'Relieving Letter',
      url: exitRecord.relievingLetterUrl || null,
      isApplicable: true,
    },
    {
      type: 'service',
      name: 'Service Certificate',
      url: exitRecord.serviceCertificateUrl || null,
      isApplicable: true,
    },
    {
      type: 'refcheck',
      name: 'Ref-Check Profile',
      url: remarksObj.refCheckProfileUrl || null,
      isApplicable: true,
    },
    {
      type: 'termination',
      name: 'Termination Letter',
      url: remarksObj.terminationLetterUrl || null,
      isApplicable: exitRecord.exitReason === 'Terminated' || !!remarksObj.terminationLetterUrl,
    },
  ];

  let totalSentCount = 0;
  let totalFailedCount = 0;
  let docsWithSent = 0;
  let totalAttempts = dispatches.length;

  const docStatuses = docDefs.map((doc) => {
    const docDispatches = dispatches.filter((d) => d.documentType === doc.type);
    const successfulSends = docDispatches.filter((d) => d.status === 'SENT' || d.status === 'DELIVERED');
    const failedSends = docDispatches.filter((d) => d.status === 'FAILED' || d.status === 'BOUNCED');
    const lastDispatch = docDispatches[0] || null;

    let status = 'NOT_GENERATED';
    if (doc.url) {
      status = 'GENERATED';
    }
    if (docDispatches.length > 0) {
      if (lastDispatch.status === 'SENT' || lastDispatch.status === 'DELIVERED') {
        status = 'SENT';
      } else if (lastDispatch.status === 'FAILED' || lastDispatch.status === 'BOUNCED') {
        status = 'FAILED';
      }
    }

    const sentCount = successfulSends.length;
    const failedCount = failedSends.length;

    totalSentCount += sentCount;
    totalFailedCount += failedCount;
    if (sentCount > 0) docsWithSent += 1;

    return {
      documentType: doc.type,
      documentName: doc.name,
      fileUrl: doc.url,
      status, // "NOT_GENERATED" | "GENERATED" | "PENDING" | "SENT" | "FAILED"
      sentCount,
      failedCount,
      totalAttempts: docDispatches.length,
      lastSentAt: lastDispatch?.sentAt || null,
      lastRecipientEmail: lastDispatch?.recipientEmail || null,
      isApplicable: doc.isApplicable,
      history: docDispatches.map((d) => ({
        id: d.id,
        status: d.status,
        attemptNumber: d.attemptNumber,
        recipientEmail: d.recipientEmail,
        sentByName: d.sentByName || 'HR Operations',
        sentAt: d.sentAt,
        deliveredAt: d.deliveredAt,
        failureReason: d.failureReason,
        emailMessageId: d.emailMessageId,
      })),
    };
  });

  const applicableDocs = docStatuses.filter((d) => d.isApplicable);
  const totalApplicable = applicableDocs.length;

  let overallStatus = 'PENDING';
  if (totalFailedCount > 0 && docsWithSent === 0) {
    overallStatus = 'ATTENTION_REQUIRED';
  } else if (docsWithSent === totalApplicable && totalApplicable > 0) {
    overallStatus = 'ALL_SENT';
  } else if (docsWithSent > 0) {
    overallStatus = 'PARTIALLY_SENT';
  } else if (applicableDocs.every((d) => d.status === 'NOT_GENERATED')) {
    overallStatus = 'PENDING';
  }

  return {
    documents: docStatuses,
    summary: {
      totalDocuments: totalApplicable,
      successfullySentDocs: docsWithSent,
      pendingDocs: totalApplicable - docsWithSent,
      failedAttempts: totalFailedCount,
      totalSentCount,
      totalAttempts,
      overallStatus, // "ALL_SENT" | "PARTIALLY_SENT" | "PENDING" | "ATTENTION_REQUIRED"
    },
    allDispatches: dispatches.map((d) => ({
      id: d.id,
      documentType: d.documentType,
      documentName: d.documentName,
      status: d.status,
      attemptNumber: d.attemptNumber,
      recipientEmail: d.recipientEmail,
      sentByName: d.sentByName || 'HR Operations',
      sentAt: d.sentAt,
      failureReason: d.failureReason,
    })),
  };
}

/**
 * Records a document dispatch attempt into the immutable audit history.
 */
export async function recordDocumentDispatch({
  tenantId,
  exitDetailsId,
  employeeId,
  documentType,
  documentName,
  fileUrl,
  recipientEmail,
  status,
  idempotencyKey,
  sentById,
  sentByName,
  failureReason = null,
  emailMessageId = null,
  customMessage = null,
  metadata = null,
}) {
  // Determine attempt number for this document type on this exit
  const previousAttempts = await prisma.exitDocumentDispatch.count({
    where: { exitDetailsId, documentType },
  });

  const attemptNumber = previousAttempts + 1;

  return prisma.exitDocumentDispatch.create({
    data: {
      tenantId,
      exitDetailsId,
      employeeId,
      documentType,
      documentName,
      fileUrl: fileUrl || null,
      recipientEmail: (recipientEmail || '').trim().toLowerCase(),
      status, // "SENT" | "FAILED"
      attemptNumber,
      idempotencyKey: idempotencyKey || null,
      sentById: sentById || null,
      sentByName: sentByName || 'HR Operations',
      failureReason: failureReason || null,
      emailMessageId: emailMessageId || null,
      customMessage: customMessage || null,
      metadata: metadata || null,
    },
  });
}

