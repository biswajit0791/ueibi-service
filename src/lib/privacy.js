import crypto from 'crypto';

export const ANONYMITY_THRESHOLD = 1;

/**
 * Deterministically scramble items using a hash so chronological sequence cannot be deduced.
 */
function deterministicSort(items) {
  return [...items].sort((a, b) => {
    const hashA = crypto.createHash('sha256').update(String(a.id || '')).digest('hex');
    const hashB = crypto.createHash('sha256').update(String(b.id || '')).digest('hex');
    return hashA.localeCompare(hashB);
  });
}

/**
 * Format a date to date-only string (YYYY-MM-DD) or null to avoid exposing exact minutes/seconds
 * that could be correlated with nomination invitations or email logs.
 */
function maskTimestamp(date) {
  if (!date) return null;
  try {
    const d = new Date(date);
    return isNaN(d.getTime()) ? null : d.toISOString().split('T')[0];
  } catch {
    return null;
  }
}

/**
 * Anonymize peer feedback items for the recipient (or non-admin).
 * Enforces the anonymity response threshold (minimum 3 submissions).
 *
 * @param {Array} rawItems - Array of feedback items (from mapNominationsToFeedbackItems)
 * @param {Object} options - { threshold: number, isPrivileged: boolean }
 * @returns {Object} Sanitized feedback response payload
 */
export function anonymizeFeedbackForRecipient(rawItems = [], options = {}) {
  const threshold = typeof options.threshold === 'number' ? options.threshold : ANONYMITY_THRESHOLD;
  const isPrivileged = Boolean(options.isPrivileged);
  const count = rawItems.length;

  // Calculate average rating if any items exist
  const averageRating = count > 0
    ? (rawItems.reduce((acc, curr) => acc + (Number(curr.rating) || 0), 0) / count).toFixed(1)
    : '0.0';

  // If user is privileged (CMD or Super Admin in audit context) AND not viewing their own feedback
  if (isPrivileged) {
    return {
      count,
      threshold,
      thresholdMet: true,
      averageRating,
      items: rawItems.map((item, idx) => ({
        id: item.id,
        nominationId: item.nominationId,
        rating: Number(item.rating),
        strengths: item.strengths,
        growthAreas: item.growthAreas || item.improvements || '',
        createdAt: item.createdAt,
        reviewerId: item.reviewerId,
        reviewer: item.reviewer || null,
        reviewerName: item.reviewer?.name || `Reviewer ${idx + 1}`,
        isAnonymous: false,
      })),
    };
  }

  // Recipient / employee view: Anonymity threshold enforcement
  const thresholdMet = count >= threshold;

  if (!thresholdMet) {
    return {
      count,
      threshold,
      thresholdMet: false,
      averageRating: null, // Do not expose average rating when threshold is not met to prevent rating deduction
      message: `A minimum of ${threshold} submitted responses is required to protect reviewer anonymity. Currently ${count} of ${threshold} received.`,
      items: [], // Withhold individual responses until threshold is reached
    };
  }

  // Threshold reached: Anonymize items with sequential labels and stripped metadata
  const scrambled = deterministicSort(rawItems);
  const sanitizedItems = scrambled.map((item, index) => {
    const reviewerIndex = index + 1;
    return {
      id: item.id,
      rating: Number(item.rating),
      strengths: item.strengths,
      growthAreas: item.growthAreas || item.improvements || '',
      reviewerName: `Anonymous Reviewer ${reviewerIndex}`,
      reviewerRole: 'Anonymous Reviewer',
      isAnonymous: true,
      createdAt: maskTimestamp(item.createdAt),
      // Explicitly exclude reviewerId, reviewer object, email, department, designation, nominationId
    };
  });

  return {
    count,
    threshold,
    thresholdMet: true,
    averageRating,
    items: sanitizedItems,
  };
}

/**
 * Anonymize peer nominations for the recipient's tracking log.
 * Shows request status (Pending vs Submitted) without revealing who submitted which.
 *
 * @param {Array} nominations - Array of PeerNomination DB records
 * @param {Object} options - { isPrivileged: boolean }
 * @returns {Array} Sanitized nomination items
 */
export function anonymizeNominationsForRecipient(nominations = [], options = {}) {
  const isPrivileged = Boolean(options.isPrivileged);

  if (isPrivileged) {
    return nominations.map((n) => ({
      id: n.id,
      reviewerId: n.reviewerId,
      name: n.reviewer?.name || 'Colleague',
      email: n.reviewer?.email,
      designation: n.reviewer?.designation,
      department: n.reviewer?.department,
      status: n.status,
      createdAt: n.createdAt,
    }));
  }

  // For recipient: sort deterministically so labels are stable
  const scrambled = deterministicSort(nominations);

  return scrambled.map((n, index) => {
    const reviewerNumber = index + 1;
    const isSubmitted = n.status === 'COMPLETED';
    const isRejected = n.status === 'REJECTED';

    return {
      id: n.id,
      name: `Anonymous Reviewer ${reviewerNumber}`,
      status: n.status,
      statusLabel: isSubmitted ? 'Submitted' : isRejected ? 'Declined' : 'Pending',
      summary: isSubmitted ? 'Feedback submitted' : isRejected ? 'Nomination declined' : 'Feedback pending',
      isSubmitted,
      canCancel: n.status === 'PENDING',
      createdAt: maskTimestamp(n.createdAt),
      feedback: n.feedback
        ? {
            id: n.feedback.id,
            rating: Number(n.feedback.rating),
            strengths: n.feedback.strengths,
            growthAreas: n.feedback.growthAreas || n.feedback.improvements || '',
            createdAt: maskTimestamp(n.feedback.createdAt),
          }
        : null,
      // Identity fields are completely omitted
    };
  });
}

/**
 * Legacy serializer compatibility.
 */
export function stripPeerReviewerIdentity(feedback, requesterRole) {
  const isPrivileged = requesterRole === 'CMD' || requesterRole === 'SUPER_ADMIN';

  const sanitizeItem = (item) => {
    if (!item) return item;
    const cloned = JSON.parse(JSON.stringify(item));

    if (!isPrivileged) {
      delete cloned.reviewerId;
      if (cloned.reviewer) {
        delete cloned.reviewer;
      }
      if (cloned.nomination) {
        delete cloned.nomination.reviewerId;
        if (cloned.nomination.reviewer) {
          delete cloned.nomination.reviewer;
        }
      }
      cloned.isAnonymous = true;
      cloned.reviewerName = 'Anonymous Reviewer';
    }

    return cloned;
  };

  if (Array.isArray(feedback)) {
    return feedback.map(sanitizeItem);
  }
  return sanitizeItem(feedback);
}
