import { useState } from 'react';
import { api, saveToken } from '../api.js';

export default function AuthPanel({ onAuthenticated, setNotice, setError }) {
  const [mode, setMode] = useState('login');
  const [busy, setBusy] = useState(false);
  const [fields, setFields] = useState({});

  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setFields({});
    setError('');
    const form = new FormData(event.currentTarget);
    const body = Object.fromEntries(form.entries());
    try {
      if (mode === 'register') {
        delete body.confirmPassword;
        const result = await api('/api/auth/register', { method: 'POST', body, token: null });
        setNotice(`${result.message}. Sign in to continue.`);
        setMode('login');
        event.currentTarget.reset();
      } else {
        const result = await api('/api/auth/login', { method: 'POST', body, token: null });
        saveToken(result.token);
        onAuthenticated(result.user);
        setNotice(`Welcome, ${result.user.name}.`);
      }
    } catch (error) {
      setError(error.message);
      setFields(error.fields || {});
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="auth-card">
      <div className="segmented">
        <button className={mode === 'login' ? 'selected' : ''} type="button" onClick={() => setMode('login')}>Sign in</button>
        <button className={mode === 'register' ? 'selected' : ''} type="button" onClick={() => setMode('register')}>Create account</button>
      </div>
      <form onSubmit={submit}>
        {mode === 'register' && (
          <>
            <label>Full name<input name="name" autoComplete="name" required minLength="2" maxLength="50" /></label>
            <label>Role<select name="role" defaultValue="Attendee" required><option value="Attendee">Attendee</option><option value="Organizer">Organizer</option></select></label>
            <label>Phone (optional)<input name="phone" autoComplete="tel" inputMode="numeric" /></label>
          </>
        )}
        <label>Email<input name="email" type="email" autoComplete="email" required /></label>
        <label>Password<input name="password" type="password" autoComplete={mode === 'login' ? 'current-password' : 'new-password'} required minLength={mode === 'register' ? 8 : undefined} maxLength={mode === 'register' ? 72 : undefined} /></label>
        {mode === 'register' && <p className="hint">8-72 characters with an uppercase letter, a lowercase letter, and a digit.</p>}
        {Object.entries(fields).map(([field, message]) => <small className="field-error" key={field}>{message}</small>)}
        <button className="primary full" type="submit" disabled={busy}>{busy ? 'Please wait…' : mode === 'login' ? 'Sign in' : 'Create account'}</button>
      </form>
    </section>
  );
}
