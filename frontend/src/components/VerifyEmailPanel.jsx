import { useEffect, useRef, useState } from 'react';
import { api } from '../api.js';
import { friendlyError } from '../errors.js';

// One request per token, even if React runs the effect twice in development: a second request would
// find the single-use token already used and wrongly show an error.
const attempts = new Map();
function verifyOnce(token) {
  if (!attempts.has(token)) {
    attempts.set(token, api('/api/auth/verify-email', { method: 'POST', body: { token }, token: null }));
  }
  return attempts.get(token);
}

// Landing page for the link in the verification email (<app>/#verify-email=<token>).
export default function VerifyEmailPanel({ token, user, onClose, onVerified }) {
  const [state, setState] = useState({ phase: 'verifying' });
  const [attempt, setAttempt] = useState(0);
  const [resend, setResend] = useState({ busy: false, kind: '', text: '' });
  const heading = useRef(null);
  const onVerifiedRef = useRef(onVerified);

  useEffect(() => { onVerifiedRef.current = onVerified; }, [onVerified]);

  useEffect(() => {
    let active = true;
    setState({ phase: 'verifying' });
    verifyOnce(token)
      .then(() => {
        if (!active) return;
        setState({ phase: 'success' });
        onVerifiedRef.current();
      })
      .catch((error) => {
        // A 400 is final (bad, expired or used link). Anything else (network, rate limit) can be retried.
        if (error.status !== 400) attempts.delete(token);
        if (active) setState({ phase: 'failed', status: error.status, message: friendlyError(error) });
      });
    return () => { active = false; };
  }, [token, attempt]);

  // Move keyboard and screen-reader focus to the result.
  useEffect(() => {
    if (state.phase !== 'verifying') heading.current?.focus();
  }, [state.phase]);

  async function requestNewLink() {
    setResend({ busy: true, kind: '', text: '' });
    try {
      await api('/api/auth/resend-verification', { method: 'POST' });
      setResend({ busy: false, kind: 'ok', text: `We sent a new verification link to ${user.email}. The old link no longer works.` });
    } catch (error) {
      if (error.status === 409) {
        onVerifiedRef.current();
        setResend({ busy: false, kind: 'ok', text: 'Your email address is already verified.' });
        return;
      }
      setResend({ busy: false, kind: 'error', text: friendlyError(error) });
    }
  }

  return (
    <section className="verify-card" aria-live="polite">
      {state.phase === 'verifying' && (
        <>
          <h2 ref={heading} tabIndex={-1}>Verifying your email…</h2>
          <p role="status">Please wait a moment.</p>
        </>
      )}

      {state.phase === 'success' && (
        <>
          <h2 ref={heading} tabIndex={-1}>Email verified</h2>
          <p>Thank you! Your email address is confirmed{user ? ', so you can now create and register for events.' : '. Sign in to continue.'}</p>
          <button className="primary" type="button" onClick={onClose}>{user ? 'Continue' : 'Go to sign in'}</button>
        </>
      )}

      {state.phase === 'failed' && state.status === 400 && (
        <>
          <h2 ref={heading} tabIndex={-1}>This link did not work</h2>
          <p>This verification link is invalid, has expired, or was already used.</p>
          {user ? (
            <div className="verify-actions">
              <button className="primary" type="button" onClick={requestNewLink} disabled={resend.busy}>
                {resend.busy ? 'Sending…' : 'Send me a new link'}
              </button>
              <button className="outline" type="button" onClick={onClose}>Dismiss</button>
            </div>
          ) : (
            <>
              <p>Sign in to request a new verification link.</p>
              <button className="primary" type="button" onClick={onClose}>Go to sign in</button>
            </>
          )}
          {resend.text && <p className={`verify-status ${resend.kind}`} role={resend.kind === 'error' ? 'alert' : 'status'}>{resend.text}</p>}
        </>
      )}

      {state.phase === 'failed' && state.status !== 400 && (
        <>
          <h2 ref={heading} tabIndex={-1}>We could not verify your email</h2>
          <p role="alert">{state.message}</p>
          <div className="verify-actions">
            <button className="primary" type="button" onClick={() => setAttempt((value) => value + 1)}>Try again</button>
            <button className="outline" type="button" onClick={onClose}>Dismiss</button>
          </div>
        </>
      )}
    </section>
  );
}
