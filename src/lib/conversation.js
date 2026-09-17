// Deterministic conversation keys for 1:1 direct messages.
//
// Both participants must derive the SAME id from their own point of view, so the
// two user ids are sorted before joining. The tenant is part of the key so a
// conversation can never span tenants even if ids were to collide.

export function conversationIdFor(tenantId, userA, userB) {
  if (!tenantId) throw new Error('conversationIdFor: tenantId is required');
  if (!userA || !userB) throw new Error('conversationIdFor: both participant ids are required');
  const [first, second] = [String(userA), String(userB)].sort();
  return `${tenantId}:${first}__${second}`;
}

// The participants encoded in a conversation id, or null if it is not a DM key
// (e.g. the quarantined '__legacy__:<tenant>' buckets created by the migration).
export function participantsOf(conversationId) {
  if (typeof conversationId !== 'string') return null;
  const sep = conversationId.indexOf(':');
  if (sep === -1) return null;
  const pair = conversationId.slice(sep + 1).split('__');
  if (pair.length !== 2 || !pair[0] || !pair[1]) return null;
  return pair;
}

export function isParticipant(conversationId, userId) {
  const pair = participantsOf(conversationId);
  return Boolean(pair && pair.includes(String(userId)));
}
