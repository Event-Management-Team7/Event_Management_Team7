// Reads the Retry-After response header: either a number of seconds or an HTTP date.
// Returns whole seconds (at least 1), or null when the header is missing or unusable.
export function parseRetryAfter(value, now = Date.now()) {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  if (!text) return null;
  if (/^\d+$/.test(text)) {
    const seconds = Number(text);
    return seconds > 0 ? seconds : null;
  }
  const date = Date.parse(text);
  if (Number.isNaN(date)) return null;
  const seconds = Math.ceil((date - now) / 1000);
  return seconds > 0 ? seconds : null;
}

export function formatWait(seconds) {
  if (!Number.isFinite(seconds) || seconds <= 0) return 'a little while';
  const whole = Math.ceil(seconds);
  if (whole < 60) return `${whole} ${whole === 1 ? 'second' : 'seconds'}`;
  if (whole < 3600) {
    const minutes = Math.ceil(whole / 60);
    return `${minutes} ${minutes === 1 ? 'minute' : 'minutes'}`;
  }
  const hours = Math.ceil(whole / 3600);
  return `${hours} ${hours === 1 ? 'hour' : 'hours'}`;
}

export function tooManyAttemptsMessage(retryAfterSeconds) {
  const wait = formatWait(retryAfterSeconds);
  return retryAfterSeconds
    ? `Too many attempts. Please try again in ${wait}.`
    : 'Too many attempts. Please wait a little while and try again.';
}
