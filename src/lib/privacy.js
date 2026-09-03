/**
 * Serializer to enforce peer reviewer anonymity in 360 feedback endpoints.
 * Removes reviewerId, reviewer joined records, and personal identifying fields
 * unless the requester has CMD or SUPER_ADMIN role.
 *
 * @param {Array|Object} feedback - Single feedback object or array of feedback objects
 * @param {string} requesterRole - The UserRole of the requesting user
 * @returns {Array|Object} Sanitized feedback data
 */
export function stripPeerReviewerIdentity(feedback, requesterRole) {
  const isPrivileged = requesterRole === 'CMD' || requesterRole === 'SUPER_ADMIN';

  const sanitizeItem = (item) => {
    if (!item) return item;
    // Deep clone to prevent mutating original in-memory object
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
      cloned.reviewerName = 'Anonymous Peer';
    }

    return cloned;
  };

  if (Array.isArray(feedback)) {
    return feedback.map(sanitizeItem);
  }
  return sanitizeItem(feedback);
}
