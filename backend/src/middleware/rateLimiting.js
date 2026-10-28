import { rateLimit } from 'express-rate-limit';

const DEFAULT_WINDOW_MS = 15 * 60 * 1000;
const DEFAULT_LIMIT = 100;
const DEFAULT_PUBLIC_AUTH_LIMIT = 10;

function createRateLimiter({ limit, ...options }) {
  return rateLimit({
    windowMs: DEFAULT_WINDOW_MS,
    ...options,
    limit,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many requests, please try again later.' }
  });
}

export function createProtectedRouteRateLimiter(options = {}) {
  return createRateLimiter({ limit: DEFAULT_LIMIT, ...options });
}

export function createPublicAuthRateLimiter(options = {}) {
  return createRateLimiter({ limit: DEFAULT_PUBLIC_AUTH_LIMIT, ...options });
}
