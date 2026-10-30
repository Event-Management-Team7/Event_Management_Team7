import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import { createRateLimitOptions, PUBLIC_AUTH_WINDOW_MS } from '../middleware/rateLimiting.js';
import { MAX_CAPTCHA_TOKEN_LENGTH } from '../services/captcha.js';
import { sendMailSafely } from '../services/mailer.js';
import { isObjectBody, validateRegistration } from '../util/validation.js';

// The link opens the web app's verification page (the token is in the URL fragment, so it is not sent to
// the server or written to access logs); the page then calls POST /api/auth/verify-email.
function buildVerificationUrl(appBaseUrl, token) {
  const url = new URL('/', appBaseUrl);
  url.hash = `verify-email=${token}`;
  return url.toString();
}

// A CAPTCHA is required on login once an email or an IP has this many recent failures.
const CAPTCHA_AFTER_FAILURES = 3;
const RESEND_WINDOW_MS = 60 * 60 * 1000;
const RESEND_LIMIT_PER_USER = 3;

export function createAuthRouter({
  authService,
  authentication,
  mailer,
  appBaseUrl,
  captcha,
  loginFailures,
  protectedRouteRateLimitOptions,
  publicAuthRateLimitOptions = {}
}) {
  const router = Router();

  // Issues a fresh token (which invalidates any earlier one) and emails the link.
  // A mail failure never fails the request; the token is never logged or returned.
  async function sendVerificationEmail(user) {
    const token = authService.createEmailVerificationToken(user.id);
    if (!appBaseUrl) {
      console.error('Email delivery failed');
      return;
    }
    try {
      await sendMailSafely(mailer, {
        to: user.email,
        subject: 'Verify your EMRS email address',
        text: [
          'Please verify your email address for Event Management and Registration System (EMRS).',
          '',
          `Verify your email address: ${buildVerificationUrl(appBaseUrl, token)}`,
          '',
          'The link works once and expires in 24 hours.',
          'If you did not create this account, you can ignore this message.'
        ].join('\n')
      });
    } catch {
      console.error('Email delivery failed');
    }
  }

  // Returns true when the request carries a valid CAPTCHA token; otherwise sends the error response and returns false.
  async function passesCaptcha(req, res) {
    const token = typeof req.body.captchaToken === 'string' ? req.body.captchaToken.trim() : '';
    if (!token) {
      res.status(400).json({ error: 'CAPTCHA required', captchaRequired: true });
      return false;
    }
    const result = token.length > MAX_CAPTCHA_TOKEN_LENGTH
      ? { ok: false }
      : await captcha.verify(token, req.ip);
    if (result.unavailable) {
      res.status(503).json({ error: 'CAPTCHA verification is unavailable. Please try again later.' });
      return false;
    }
    if (!result.ok) {
      res.status(400).json({ error: 'CAPTCHA verification failed', captchaRequired: true });
      return false;
    }
    return true;
  }

  router.get('/captcha-config', rateLimit(createRateLimitOptions(
    60,
    { windowMs: PUBLIC_AUTH_WINDOW_MS }
  )), (_req, res) => {
    res.status(200).json({ provider: captcha.provider, siteKey: captcha.siteKey });
  });

  router.post('/register', rateLimit(createRateLimitOptions(
    10,
    { windowMs: PUBLIC_AUTH_WINDOW_MS, ...publicAuthRateLimitOptions.registration }
  )), async (req, res, next) => {
    if (req.body === undefined) {
      res.status(400).json({ error: 'Malformed JSON' });
      return;
    }
    if (!isObjectBody(req.body)) {
      res.status(400).json({ error: 'Request body must be a JSON object' });
      return;
    }
    const input = {
      name: typeof req.body.name === 'string' ? req.body.name : '',
      email: typeof req.body.email === 'string' ? req.body.email : '',
      phone: typeof req.body.phone === 'string' ? req.body.phone : '',
      password: typeof req.body.password === 'string' ? req.body.password : '',
      role: typeof req.body.role === 'string' ? req.body.role : ''
    };
    const fields = validateRegistration(input);
    if (Object.keys(fields).length) {
      res.status(400).json({ error: 'Validation failed', fields });
      return;
    }
    try {
      if (!(await passesCaptcha(req, res))) return;
      const user = authService.register(input);
      if (!user) {
        res.status(409).json({ error: 'Email already registered' });
        return;
      }
      await sendVerificationEmail(user);
      res.status(201).json({ message: 'Registration successful', user });
    } catch (error) {
      next(error);
    }
  });

  router.post('/verify-email', rateLimit(createRateLimitOptions(
    30,
    publicAuthRateLimitOptions.verification
  )), (req, res, next) => {
    if (!isObjectBody(req.body)) {
      res.status(400).json({ error: 'Malformed JSON' });
      return;
    }
    const token = typeof req.body.token === 'string' ? req.body.token : '';
    try {
      if (!authService.verifyEmail(token)) {
        res.status(400).json({ error: 'Invalid or expired email verification token' });
        return;
      }
      res.status(200).json({ message: 'Email verified successfully' });
    } catch (error) {
      next(error);
    }
  });

  router.post('/resend-verification', rateLimit(createRateLimitOptions(
    10,
    { windowMs: PUBLIC_AUTH_WINDOW_MS, ...publicAuthRateLimitOptions.resendVerification }
  )), authentication.authenticate, rateLimit(createRateLimitOptions(
    RESEND_LIMIT_PER_USER,
    {
      windowMs: RESEND_WINDOW_MS,
      keyGenerator: (req) => `user:${req.user.id}`,
      ...publicAuthRateLimitOptions.resendVerificationPerUser
    }
  )), async (req, res, next) => {
    if (req.user.emailVerified) {
      res.status(409).json({ error: 'Email is already verified' });
      return;
    }
    try {
      await sendVerificationEmail(req.user);
      res.status(200).json({ message: 'Verification email sent' });
    } catch (error) {
      next(error);
    }
  });

  router.post('/login', rateLimit(createRateLimitOptions(
    10,
    { windowMs: PUBLIC_AUTH_WINDOW_MS, ...publicAuthRateLimitOptions.login }
  )), async (req, res, next) => {
    if (!isObjectBody(req.body)) {
      res.status(400).json({ error: 'Malformed JSON' });
      return;
    }
    const email = typeof req.body.email === 'string' ? req.body.email : '';
    const password = typeof req.body.password === 'string' ? req.body.password : '';
    const fields = {};
    if (!email.trim()) fields.email = 'Email is required.';
    if (!password) fields.password = 'Password is required.';
    if (Object.keys(fields).length) {
      res.status(400).json({ error: 'Validation failed', fields });
      return;
    }
    // Failures are counted per submitted email (whether or not the account exists, so this reveals nothing) and per IP.
    const emailKey = `email:${email.trim().toLowerCase()}`;
    const ipKey = `ip:${req.ip}`;
    const captchaRequired = () => (
      loginFailures.count(emailKey) >= CAPTCHA_AFTER_FAILURES || loginFailures.count(ipKey) >= CAPTCHA_AFTER_FAILURES
    );
    try {
      if (captchaRequired() && !(await passesCaptcha(req, res))) return;
      const result = authService.login(email, password);
      if (result.status === 'ok') {
        loginFailures.clear(emailKey);
        res.status(200).json({
          token: result.token,
          expiresAt: result.expiresAt,
          user: result.user
        });
        return;
      }
      loginFailures.record(emailKey);
      loginFailures.record(ipKey);
      if (result.status === 'locked') {
        res.set('Retry-After', String(result.retryAfterSeconds));
        res.status(429).json({
          error: 'Too many failed attempts. Account temporarily locked.',
          captchaRequired: captchaRequired()
        });
      } else {
        res.status(401).json({ error: 'Invalid email or password.', captchaRequired: captchaRequired() });
      }
    } catch (error) {
      next(error);
    }
  });

  router.post('/logout', (req, res, next) => {
    const authorization = req.get('Authorization') ?? '';
    if (!authorization.startsWith('Bearer ') || authorization.length <= 7) {
      res.status(400).json({ error: 'Invalid or missing token' });
      return;
    }
    try {
      if (!authService.logout(authorization.slice(7))) {
        res.status(400).json({ error: 'Invalid or missing token' });
        return;
      }
      res.status(200).json({ message: 'Logged out successfully' });
    } catch (error) {
      next(error);
    }
  });

  router.get('/me', rateLimit(createRateLimitOptions(
    100,
    protectedRouteRateLimitOptions
  )), authentication.authenticate, (req, res) => {
    const { id, name, email, phone, role, emailVerified } = req.user;
    res.status(200).json({ user: { id, name, email, phone, role, emailVerified } });
  });

  return router;
}
