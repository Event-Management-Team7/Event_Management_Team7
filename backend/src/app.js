import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import { createAuthentication } from './middleware/authentication.js';
import { createAuthRouter } from './routes/auth.js';
import { createEventsRouter } from './routes/events.js';
import { createRegistrationsRouter } from './routes/registrations.js';
import { createTicketsRouter } from './routes/tickets.js';
import { AuthService } from './services/auth.js';
import { EventService } from './services/events.js';
import { RegistrationService } from './services/registrations.js';
import { TicketService } from './services/tickets.js';
import { createCaptchaVerifier } from './services/captcha.js';
import { FailureTracker } from './services/failureTracker.js';
import { createMailer } from './services/mailer.js';
import { ReminderService } from './services/reminders.js';
import { parseTrustProxy } from './util/trustProxy.js';

export function createApp({
  db,
  clock,
  passwordCost,
  jwtSecret,
  mailer,
  appBaseUrl,
  captcha,
  loginFailures,
  trustProxy,
  webDir,
  protectedRouteRateLimitOptions,
  publicAuthRateLimitOptions = {},
  enableReminderInterval = false
} = {}) {
  if (!db) throw new Error('A database instance is required');

  const resolvedMailer = mailer ?? createMailer();
  const resolvedCaptcha = captcha ?? createCaptchaVerifier();
  const resolvedLoginFailures = loginFailures ?? new FailureTracker({ clock });
  const authService = new AuthService(db, { clock, cost: passwordCost, jwtSecret });
  const eventService = new EventService(db, clock);
  const registrationService = new RegistrationService(db, clock);
  const ticketService = new TicketService(db, clock);
  const reminderService = new ReminderService(db, resolvedMailer, clock);
  if (enableReminderInterval) {
    reminderService.start();
  }
  const authentication = createAuthentication(authService);

  const app = express();
  app.reminderService = reminderService;
  app.disable('x-powered-by');

  // Security headers (EMRS-SEC-002, EMT-48)
  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    next();
  });

  // Behind Docker or a reverse proxy, rate limiting needs the real client IP (see util/trustProxy.js).
  app.set('trust proxy', parseTrustProxy(trustProxy ?? process.env.TRUST_PROXY));
  app.use(express.json({ limit: '1mb' }));

  const healthHandler = (_req, res) => {
    res.status(200).json({
      status: 'ok',
      app: 'Event Management and Registration System (EMRS)',
      version: '1.0.0'
    });
  };
  app.get('/health', healthHandler);
  app.get('/api/health', healthHandler);
  app.use('/api/auth', createAuthRouter({
    authService,
    authentication,
    mailer: resolvedMailer,
    appBaseUrl: appBaseUrl ?? process.env.APP_BASE_URL,
    captcha: resolvedCaptcha,
    loginFailures: resolvedLoginFailures,
    protectedRouteRateLimitOptions,
    publicAuthRateLimitOptions
  }));
  app.use('/api/events', createEventsRouter({
    authentication,
    eventService,
    registrationService,
    mailer: resolvedMailer,
    registrationRateLimitOptions: protectedRouteRateLimitOptions,
    protectedRouteRateLimitOptions
  }));
  app.use('/api/registrations', createRegistrationsRouter({ authentication, registrationService, mailer: resolvedMailer }));
  app.use('/api/tickets', createTicketsRouter({ authService, authentication, ticketService, mailer: resolvedMailer }));

  let staticDir = webDir ?? process.env.EMRS_WEB_DIR;
  if (!staticDir) {
    const defaultFrontendDist = path.resolve('frontend/dist');
    if (fs.existsSync(defaultFrontendDist)) {
      staticDir = defaultFrontendDist;
    }
  }
  if (staticDir) {
    app.use(express.static(staticDir));
    app.use((req, res, next) => {
      if (req.method !== 'GET') return next();
      if (req.path.startsWith('/api/')) return next();
      const indexPath = path.join(staticDir, 'index.html');
      if (fs.existsSync(indexPath)) {
        return res.sendFile(indexPath);
      }
      next();
    });
  }

  app.use((_req, res) => res.status(404).json({ error: 'Not found' }));
  app.use((error, _req, res, _next) => {
    if (error?.type === 'entity.parse.failed') {
      res.status(400).json({ error: 'Malformed JSON' });
      return;
    }
    console.error('Unhandled API error:', error);
    res.status(500).json({ error: 'Internal server error' });
  });

  return app;
}
