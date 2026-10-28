import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import { createRateLimitOptions } from '../middleware/rateLimiting.js';
import { sendMailSafely } from '../services/mailer.js';
import { isObjectBody, validateRegistration } from '../util/validation.js';

export function createAuthRouter({
  authService,
  authentication,
  mailer,
  appBaseUrl,
  protectedRouteRateLimitOptions,
  publicAuthRateLimitOptions = {}
}) {
  const router = Router();

  router.post('/register', rateLimit(createRateLimitOptions(
    5,
    publicAuthRateLimitOptions.registration
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
      const user = authService.register(input);
      if (!user) {
        res.status(409).json({ error: 'Email already registered' });
        return;
      }
      const token = authService.createEmailVerificationToken(user.id);
      if (!appBaseUrl) {
        console.error('Email delivery failed');
      } else {
        try {
          const verificationUrl = new URL('/api/auth/verify-email', appBaseUrl);
          verificationUrl.searchParams.set('token', token);
          await sendMailSafely(mailer, {
            to: user.email,
            subject: 'Verify your EMRS email address',
            text: [
              'Please verify your email address for Event Management and Registration System (EMRS).',
              '',
              `Verify your email address: ${verificationUrl.toString()}`,
              '',
              'If you did not create this account, you can ignore this message.'
            ].join('\n')
          });
        } catch {
          console.error('Email delivery failed');
        }
      }
      res.status(201).json({ message: 'Registration successful', user });
    } catch (error) {
      next(error);
    }
  });

  router.get('/verify-email', rateLimit(createRateLimitOptions(
    30,
    publicAuthRateLimitOptions.verification
  )), (req, res, next) => {
    const token = typeof req.query.token === 'string' ? req.query.token : '';
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

  router.post('/login', rateLimit(createRateLimitOptions(
    10,
    publicAuthRateLimitOptions.login
  )), (req, res, next) => {
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
    try {
      const result = authService.login(email, password);
      if (result.status === 'locked') {
        res.status(429).json({ error: 'Too many failed attempts. Account temporarily locked.' });
      } else if (result.status === 'invalid') {
        res.status(401).json({ error: 'Invalid email or password.' });
      } else {
        res.status(200).json({
          token: result.token,
          expiresAt: result.expiresAt,
          user: result.user
        });
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

  router.get('/me', authentication.authenticate, rateLimit(createRateLimitOptions(
    100,
    protectedRouteRateLimitOptions
  )), (req, res) => {
    const { id, name, email, phone, role } = req.user;
    res.status(200).json({ user: { id, name, email, phone, role } });
  });

  return router;
}
