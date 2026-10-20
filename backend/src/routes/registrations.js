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
      if (!registrationService.cancel(registrationId, req.user.id)) {
        res.status(404).json({ error: 'Registration not found' });
        return;
      }
      res.status(200).json({ message: 'Registration cancelled successfully' });
    } catch (error) {
      next(error);
    }
  });

  return router;
}
