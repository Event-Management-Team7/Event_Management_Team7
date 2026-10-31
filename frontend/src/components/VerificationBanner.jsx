import { useState } from 'react';
import { api } from '../api.js';
import { friendlyError } from '../errors.js';

// Shown to signed-in users whose email is not verified yet (user.emailVerified === false).
export default function VerificationBanner({ user, onVerified }) {
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState({ kind: '', text: '' });

  if (!user || user.emailVerified !== false) return null;

  async function resend() {
    setBusy(true);
    setStatus({ kind: '', text: '' });
    try {
      await api('/api/auth/resend-verification', { method: 'POST' });
      setStatus({ kind: 'ok', text: `We sent a new verification link to ${user.email}. Check your inbox and spam folder.` });
    } catch (error) {
      if (error.status === 409) {
        // Verified in another tab or browser: refresh the user so this banner goes away.
        onVerified();
        return;
      }
      setStatus({ kind: 'error', text: friendlyError(error) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="verify-banner" aria-label="Email verification">
      <div className="verify-banner-text">
        <strong>Please verify your email address</strong>
        <p>We sent a link to <b>{user.email}</b>. Until you verify, you can browse but not create events or register for them.</p>
      </div>
      <button className="outline" type="button" onClick={resend} disabled={busy}>{busy ? 'Sending…' : 'Resend email'}</button>
      {status.text && <p className={`verify-status ${status.kind}`} role={status.kind === 'error' ? 'alert' : 'status'}>{status.text}</p>}
    </section>
  );
}
