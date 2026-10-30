const DEFAULT_WINDOW_MS = 15 * 60 * 1000;
// Login, registration and resend-verification allow 10 requests per minute per IP (EMT-29).
export const PUBLIC_AUTH_WINDOW_MS = 60 * 1000;

export function createRateLimitOptions(defaultLimit, options = {}) {
  return {
    windowMs: DEFAULT_WINDOW_MS,
    ...options,
    limit: options.limit ?? defaultLimit,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many requests, please try again later.' }
  };
}
