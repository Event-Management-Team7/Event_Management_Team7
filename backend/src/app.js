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
import { createMailer } from './services/mailer.js';

export function createApp({ db, clock, passwordCost, jwtSecret, mailer } = {}) {
  if (!db) throw new Error('A database instance is required');

  const resolvedMailer = mailer ?? createMailer();
  const authService = new AuthService(db, { clock, cost: passwordCost, jwtSecret });
  const eventService = new EventService(db, clock);
  const registrationService = new RegistrationService(db, clock);
  const ticketService = new TicketService(db, clock);
  const authentication = createAuthentication(authService);

  const app = express();
  app.disable('x-powered-by');
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
  app.use('/api/auth', createAuthRouter({ authService, authentication, mailer: resolvedMailer }));
  app.use('/api/events', createEventsRouter({ authentication, eventService, registrationService, mailer: resolvedMailer }));
  app.use('/api/registrations', createRegistrationsRouter({ authentication, registrationService, mailer: resolvedMailer }));
  app.use('/api/tickets', createTicketsRouter({ authService, authentication, ticketService, mailer: resolvedMailer }));

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
