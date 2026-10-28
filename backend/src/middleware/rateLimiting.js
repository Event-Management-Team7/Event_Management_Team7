import { rateLimit } from 'express-rate-limit';

const DEFAULT_WINDOW_MS = 15 * 60 * 1000;
const DEFAULT_LIMIT = 100;

export function createProtectedRouteRateLimiter(options = {}) {
  return rateLimit({
    windowMs: DEFAULT_WINDOW_MS,
    limit: DEFAULT_LIMIT,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many requests, please try again later.' },
    ...options
  });
}
