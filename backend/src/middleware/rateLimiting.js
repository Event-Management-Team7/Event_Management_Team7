const DEFAULT_WINDOW_MS = 15 * 60 * 1000;

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
