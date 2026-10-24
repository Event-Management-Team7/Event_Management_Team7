import { Router } from 'express';
import { isObjectBody, validateRegistration } from '../util/validation.js';

export function createAuthRouter({ authService, authentication }) {
  const router = Router();

  router.post('/register', (req, res, next) => {
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
      res.status(201).json({ message: 'Registration successful', user });
    } catch (error) {
      next(error);
    }
  });

  router.post('/login', (req, res, next) => {
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

  router.get('/me', authentication.authenticate, (req, res) => {
    const { id, name, email, phone, role } = req.user;
    res.status(200).json({ user: { id, name, email, phone, role } });
  });

  return router;
}
