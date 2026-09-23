/**
 * Cookie header parsing.
 *
 * This lived in adminAuth.js alongside the shared-password session helpers, but
 * it has nothing to do with them — the JWT middleware and the Socket.IO
 * handshake both use it to read `ueibi_session`. Extracted here so adminAuth.js
 * could be deleted with the APP_PASSWORD scheme it belonged to.
 */
export function parseCookies(cookieHeader) {
  const list = {};
  if (!cookieHeader) return list;
  cookieHeader.split(';').forEach((cookie) => {
    const parts = cookie.split('=');
    list[parts.shift().trim()] = decodeURIComponent(parts.join('='));
  });
  return list;
}
