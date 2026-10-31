// Express "trust proxy" setting from configuration (TRUST_PROXY).
// Behind Docker, a load balancer or a reverse proxy, the socket address is the proxy, so every client
// would share one rate-limit bucket. Trusting the proxy makes Express use the real client IP instead.
// It stays off by default because a client can forge X-Forwarded-For when no trusted proxy overwrites it.
export function parseTrustProxy(value) {
  if (value === undefined || value === null || value === false) return false;
  if (typeof value === 'number') return value;
  const text = String(value).trim();
  const lower = text.toLowerCase();
  if (!text || lower === 'false') return false;
  if (lower === 'true' || value === true) {
    throw new Error(
      'TRUST_PROXY=true would trust any X-Forwarded-For header and let clients bypass rate limits. ' +
      'Use the number of proxy hops (for example 1) or a list of proxy addresses.'
    );
  }
  if (/^\d+$/.test(text)) return Number(text);
  // Express also accepts 'loopback', 'linklocal', 'uniquelocal', or comma-separated IPs/CIDR ranges.
  return text;
}
