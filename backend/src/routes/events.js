import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import { createRateLimitOptions } from '../middleware/rateLimiting.js';
import { sendMailSafely } from '../services/mailer.js';
import { isObjectBody, parsePositiveId, validateEvent, validateEventFilters } from '../util/validation.js';

function eventRole(req, res, next) {
  if (req.user.role !== 'Organizer' && req.user.role !== 'Admin') {
    res.status(403).json({ error: 'Only organizers can create events.' });
    return;
  }
  next();
}

function organizerOnly(req, res, next) {
  if (req.user.role !== 'Organizer') {
    res.status(403).json({ error: 'Only organizers can create events.' });
    return;
  }
  next();
}

function eventInput(body) {
  return {
    title: body.title,
    description: body.description,
    category: body.category,
    startDateTime: body.startDateTime,
    endDateTime: body.endDateTime,
    venueType: body.venueType,
    venue: body.address === undefined ? body.venue : body.address,
    address: body.address,
    meetingLink: body.meetingLink,
    capacity: body.capacity,
    ticketTypes: body.ticketTypes,
    currency: body.currency,
    tags: body.tags
  };
}

export function createEventsRouter({
  authentication,
  eventService,
  registrationService,
  mailer,
  registrationRateLimitOptions
}) {
  const router = Router();

  router.get('/', (req, res) => {
    const { filters, fields } = validateEventFilters(req.query);
    if (Object.keys(fields).length) {
      res.status(400).json({ error: 'Validation failed', fields });
      return;
    }
    res.status(200).json({
      events: eventService.list({
        category: typeof req.query.category === 'string' ? req.query.category : '',
        search: typeof req.query.search === 'string' ? req.query.search : '',
        ...filters
      })
    });
  });

  router.get('/mine', authentication.authenticate, eventRole, (req, res) => {
    res.status(200).json({ events: eventService.listOrganizer(req.user.id) });
  });

  router.post('/', authentication.authenticate, organizerOnly, (req, res, next) => {
    if (req.body === undefined) {
      res.status(400).json({ error: 'Malformed JSON' });
      return;
    }
    if (!isObjectBody(req.body)) {
      res.status(400).json({ error: 'Malformed JSON' });
      return;
    }
    const input = eventInput(req.body);
    const fields = validateEvent(input, eventService.clock() * 1000);
    if (Object.keys(fields).length) {
      res.status(400).json({ error: 'Validation failed', fields });
      return;
    }
    try {
      const eventId = eventService.create(req.user.id, input);
      res.status(201).json({ message: 'Event created successfully', eventId });
    } catch (error) {
      next(error);
    }
  });

  router.put('/:id', authentication.authenticate, (req, res, next) => {
    const eventId = parsePositiveId(req.params.id);
    if (!eventId) {
      res.status(404).json({ error: 'Event not found' });
      return;
    }
    if (!isObjectBody(req.body)) {
      res.status(400).json({ error: 'Malformed JSON' });
      return;
    }
    const input = eventInput(req.body);
    const fields = validateEvent(input, eventService.clock() * 1000);
    if (Object.keys(fields).length) {
      res.status(400).json({ error: 'Validation failed', fields });
      return;
    }
    try {
      const result = eventService.update(eventId, req.user, input);
      if (result === 'not-found') {
        res.status(404).json({ error: 'Event not found' });
      } else if (result === 'forbidden') {
        res.status(403).json({ error: 'Only the event organizer or an admin can update this event.' });
      } else if (result === 'event-started') {
        res.status(409).json({ error: 'Event has already started' });
      } else if (result === 'event-cancelled') {
        res.status(409).json({ error: 'Cancelled events cannot be edited' });
      } else if (result === 'capacity-too-low') {
        res.status(400).json({
          error: 'Capacity cannot be lower than the current confirmed registration count'
        });
      } else {
        res.status(200).json({ message: 'Event updated successfully', event: eventService.get(eventId) });
      }
    } catch (error) {
      next(error);
    }
  });

  router.get('/:id/audit', authentication.authenticate, (req, res, next) => {
    const eventId = parsePositiveId(req.params.id);
    if (!eventId) {
      res.status(404).json({ error: 'Event not found' });
      return;
    }
    try {
      const result = eventService.auditHistory(eventId, req.user);
      if (result === 'not-found') {
        res.status(404).json({ error: 'Event not found' });
      } else if (result === 'forbidden') {
        res.status(403).json({ error: 'Only the event organizer or an admin can view this event audit history.' });
      } else {
        res.status(200).json({ audit: result });
      }
    } catch (error) {
      next(error);
    }
  });

  router.post('/:id/register', rateLimit(createRateLimitOptions(
    100,
    registrationRateLimitOptions
  )), authentication.authenticate, async (req, res, next) => {
    const eventId = parsePositiveId(req.params.id);
    if (!eventId) {
      res.status(404).json({ error: 'Event not found' });
      return;
    }
    try {
      const result = registrationService.register(eventId, req.user.id);
      if (result.result === 'not-found') {
        res.status(404).json({ error: 'Event not found' });
      } else if (result.result === 'event-cancelled') {
        res.status(400).json({ error: 'Event has been cancelled' });
      } else if (result.result === 'event-started') {
        res.status(400).json({ error: 'Event has already started' });
      } else if (result.result === 'already-registered') {
        res.status(409).json({ error: 'You are already registered for this event' });
      } else if (result.result === 'confirmed') {
        await sendMailSafely(mailer, {
          to: result.email,
          subject: `Registration confirmed: ${result.eventTitle}`,
          text: [
            `Your registration for ${result.eventTitle} is confirmed.`,
            `Event date and time: ${result.eventDateTime}`,
            `Ticket code: ${result.ticketCode}`
          ].join('\n')
        });
        res.status(200).json({
          status: 'confirmed',
          registrationId: result.registrationId,
          ticketCode: result.ticketCode,
          message: 'Registration confirmed! Your QR ticket is ready.'
        });
      } else {
        res.status(200).json({
          status: 'waitlist',
          registrationId: result.registrationId,
          message: 'Event is full. You have been placed on the waitlist.'
        });
      }
    } catch (error) {
      next(error);
    }
  });

  router.get('/:id', (req, res) => {
    const eventId = parsePositiveId(req.params.id);
    const event = eventId ? eventService.get(eventId) : null;
    if (!event) {
      res.status(404).json({ error: 'Event not found' });
      return;
    }
    res.status(200).json({ event });
  });

  router.delete('/:id', authentication.authenticate, (req, res, next) => {
    const eventId = parsePositiveId(req.params.id);
    if (!eventId) {
      res.status(404).json({ error: 'Event not found' });
      return;
    }
    try {
      const result = eventService.cancel(eventId, req.user);
      if (result === 'not-found') {
        res.status(404).json({ error: 'Event not found' });
      } else if (result === 'forbidden') {
        res.status(403).json({ error: 'Only the event organizer can cancel this event.' });
      } else {
        res.status(200).json({ message: 'Event cancelled successfully' });
      }
    } catch (error) {
      next(error);
    }
  });

  return router;
}
