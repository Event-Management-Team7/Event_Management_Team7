import { Router } from 'express';
import { isObjectBody } from '../util/validation.js';

export function createTicketsRouter({ authService, authentication, ticketService }) {
  const router = Router();

  router.post('/checkin', (req, res, next) => {
    const authorization = req.get('Authorization') ?? '';
    if (!authorization.startsWith('Bearer ') || authorization.length <= 7) {
      res.status(401).json({ error: 'Missing authentication token' });
      return;
    }
    let user;
    try {
      user = authService.authenticate(authorization.slice(7));
    } catch (error) {
      next(error);
      return;
    }
    if (!user || (user.role !== 'Organizer' && user.role !== 'Admin')) {
      res.status(403).json({ error: 'Only organizers can check in attendees.' });
      return;
    }
    if (req.body === undefined) {
      res.status(400).json({ error: 'Malformed JSON' });
      return;
    }
    if (!isObjectBody(req.body)) {
      res.status(400).json({ error: 'Malformed JSON' });
      return;
    }
    const ticketCode = typeof req.body.ticketCode === 'string' ? req.body.ticketCode : '';
    if (!ticketCode) {
      res.status(400).json({ error: 'Ticket code is required' });
      return;
    }
    try {
      const ticket = ticketService.getByCode(ticketCode);
      if (!ticket) {
        res.status(404).json({ error: 'Invalid ticket code' });
        return;
      }
      if (ticket.checked_in) {
        res.status(409).json({ error: 'Ticket has already been checked in' });
        return;
      }
      const checkedIn = ticketService.checkIn(ticket.ticket_code);
      if (!checkedIn) {
        res.status(409).json({ error: 'Ticket has already been checked in' });
        return;
      }
      res.status(200).json({
        message: 'Check-in successful!',
        attendeeName: checkedIn.attendee_name,
        eventTitle: checkedIn.event_title
      });
    } catch (error) {
      next(error);
    }
  });

  router.get('/:code', authentication.authenticate, (req, res) => {
    if (req.user.role !== 'Organizer' && req.user.role !== 'Admin') {
      res.status(403).json({ error: 'Only organizers can validate tickets.' });
      return;
    }
    const ticket = ticketService.getByCode(req.params.code);
    if (!ticket) {
      res.status(404).json({ error: 'Invalid ticket code' });
      return;
    }
    res.status(200).json({
      ticketCode: ticket.ticket_code,
      eventTitle: ticket.event_title,
      attendeeName: ticket.attendee_name,
      checkedIn: Boolean(ticket.checked_in),
      checkedInAt: ticket.checked_in_at
    });
  });

  return router;
}
