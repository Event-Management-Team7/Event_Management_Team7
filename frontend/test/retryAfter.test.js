import assert from 'node:assert/strict';
import test from 'node:test';
import { captchaNeeded, friendlyError, isEmailNotVerified } from '../src/errors.js';
import { formatWait, parseRetryAfter, tooManyAttemptsMessage } from '../src/retryAfter.js';

test('parseRetryAfter reads seconds and HTTP dates', () => {
  assert.equal(parseRetryAfter('60'), 60);
  assert.equal(parseRetryAfter(' 5 '), 5);
  const now = Date.parse('2026-10-30T10:00:00Z');
  assert.equal(parseRetryAfter('Fri, 30 Oct 2026 10:01:30 GMT', now), 90);
  assert.equal(parseRetryAfter('Fri, 30 Oct 2026 09:00:00 GMT', now), null, 'a date in the past is unusable');
});

test('parseRetryAfter ignores missing or bad values', () => {
  for (const value of [null, undefined, '', '   ', '0', '-5', '1.5', 'soon']) assert.equal(parseRetryAfter(value), null, String(value));
});

test('formatWait picks a readable unit', () => {
  assert.equal(formatWait(1), '1 second');
  assert.equal(formatWait(45), '45 seconds');
  assert.equal(formatWait(60), '1 minute');
  assert.equal(formatWait(61), '2 minutes');
  assert.equal(formatWait(300), '5 minutes');
  assert.equal(formatWait(3600), '1 hour');
  assert.equal(formatWait(7200), '2 hours');
  assert.equal(formatWait(0), 'a little while');
  assert.equal(formatWait(Number.NaN), 'a little while');
});

test('the too-many-attempts message includes the wait time when known', () => {
  assert.equal(tooManyAttemptsMessage(45), 'Too many attempts. Please try again in 45 seconds.');
  assert.equal(tooManyAttemptsMessage(300), 'Too many attempts. Please try again in 5 minutes.');
  assert.equal(tooManyAttemptsMessage(null), 'Too many attempts. Please wait a little while and try again.');
});

test('friendlyError shows the wait time for 429 and the server message otherwise', () => {
  assert.equal(friendlyError({ status: 429, retryAfter: 30, message: 'Too many requests' }), 'Too many attempts. Please try again in 30 seconds.');
  assert.match(friendlyError({ status: 429, retryAfter: null }), /wait a little while/);
  assert.equal(friendlyError({ status: 401, message: 'Invalid email or password.' }), 'Invalid email or password.');
  assert.equal(friendlyError(undefined), 'Something went wrong. Please try again.');
});

test('captchaNeeded and isEmailNotVerified read the API flags', () => {
  assert.equal(captchaNeeded({ captchaRequired: true }), true);
  assert.equal(captchaNeeded({ captchaRequired: false }), false);
  assert.equal(captchaNeeded(new Error('x')), false);
  assert.equal(isEmailNotVerified({ status: 403, code: 'email_not_verified' }), true);
  assert.equal(isEmailNotVerified({ status: 403, code: 'other' }), false);
  assert.equal(isEmailNotVerified({ status: 401, code: 'email_not_verified' }), false);
});
