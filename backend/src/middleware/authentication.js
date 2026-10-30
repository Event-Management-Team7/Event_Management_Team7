export function createAuthentication(authService) {
  function authenticate(req, res, next) {
    const authorization = req.get('Authorization') ?? '';
    if (!authorization.startsWith('Bearer ') || authorization.length <= 7) {
      res.status(401).json({ error: 'Missing authentication token' });
      return;
    }
    const user = authService.authenticate(authorization.slice(7));
    if (!user) {
      res.status(401).json({ error: 'Invalid or expired session token' });
      return;
    }
    req.user = user;
    req.token = authorization.slice(7);
    next();
  }

  function authorize(...roles) {
    return (req, res, next) => {
      if (!roles.includes(req.user.role)) {
        res.status(403).json({ error: 'Only organizers can perform this action.' });
        return;
      }
      next();
    };
  }

  // Unverified users can sign in but cannot create or register for events (EMT-28).
  function requireVerifiedEmail(req, res, next) {
    if (!req.user.emailVerified) {
      res.status(403).json({ error: 'Please verify your email', code: 'email_not_verified' });
      return;
    }
    next();
  }

  return { authenticate, authorize, requireVerifiedEmail };
}
