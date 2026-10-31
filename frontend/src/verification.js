// The emailed link is <app>/#verify-email=<token>. The token is 32 random bytes, base64url (43 characters).
const LINK_PATTERN = /^#verify-email=([A-Za-z0-9_-]{43})$/;

export function parseVerificationToken(hash) {
  const match = LINK_PATTERN.exec(typeof hash === 'string' ? hash : '');
  return match ? match[1] : null;
}
