import { Router } from 'express';
import { parsePositiveId } from '../util/validation.js';

export function createRegistrationsRouter({ authentication, registrationService }) {
  const router = Router();

  router.get('/my', authentication.authenticate, (req, res) => {
    res.status(200).json({ registrations: registrationService.listUser(req.user.id) });
  });

  router.delete('/:id', authentication.authenticate, (req, res, next) => {
    const registrationId = parsePositiveId(req.params.id);
    if (!registrationId) {
      res.status(404).json({ error: 'Registration not found' });
      return;
    }
    try {
      const result = registrationService.cancel(registrationId, req.user.id);
      if (result === false || result === 'not-found') {
        res.status(404).json({ error: 'Registration not found' });
        return;
      }
      if (result === 'forbidden') {
        res.status(403).json({ error: 'You can only cancel your own registration' });
        return;
      }
      if (result === 'event-started') {
        res.status(400).json({ error: 'Cannot cancel registration for an event that has already started' });
        return;
      }
      res.status(200).json({ message: 'Registration cancelled successfully' });
    } catch (error) {
      next(error);
    }
  });

  return router;
}
