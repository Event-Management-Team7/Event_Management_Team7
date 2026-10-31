import { tooManyAttemptsMessage } from './retryAfter.js';

// The text to show for a failed API call: a wait time for 429 (too many attempts), the server's message otherwise.
export function friendlyError(error) {
  if (error?.status === 429) return tooManyAttemptsMessage(error.retryAfter ?? null);
  return error?.message || 'Something went wrong. Please try again.';
}

// True when the API says a CAPTCHA must be completed before trying again.
export function captchaNeeded(error) {
  return error?.captchaRequired === true;
}

export function isEmailNotVerified(error) {
  return error?.status === 403 && error?.code === 'email_not_verified';
}
