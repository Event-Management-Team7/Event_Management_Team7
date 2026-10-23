import { Router } from 'express';
import { isObjectBody, parsePositiveId, validateEvent } from '../util/validation.js';

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

export function createEventsRouter({ authentication, eventService, registrationService }) {
  const router = Router();

  router.get('/', (req, res) => {
    res.status(200).json({
      events: eventService.list({
        category: typeof req.query.category === 'string' ? req.query.category : '',
        search: typeof req.query.search === 'string' ? req.query.search : ''
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
    const input = {
      title: req.body.title,
      description: req.body.description,
      category: req.body.category,
      startDateTime: req.body.startDateTime,
      endDateTime: req.body.endDateTime,
      venueType: req.body.venueType,
      venue: req.body.address === undefined ? req.body.venue : req.body.address,
      address: req.body.address,
      meetingLink: req.body.meetingLink,
      capacity: req.body.capacity,
      ticketTypes: req.body.ticketTypes,
      currency: req.body.currency,
      tags: req.body.tags
    };
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

  router.post('/:id/register', authentication.authenticate, (req, res, next) => {
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
      } else if (result.result === 'already-registered') {
        res.status(409).json({ error: 'You are already registered for this event' });
      } else if (result.result === 'confirmed') {
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
