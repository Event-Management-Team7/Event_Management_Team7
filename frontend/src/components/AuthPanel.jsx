import { useState } from 'react';
import { api, saveToken } from '../api.js';
import { captchaNeeded, friendlyError } from '../errors.js';
import Captcha from './Captcha.jsx';

export default function AuthPanel({ onAuthenticated, setNotice, setError }) {
  const [mode, setMode] = useState('login');
  const [busy, setBusy] = useState(false);
  const [fields, setFields] = useState({});
  const [captchaToken, setCaptchaToken] = useState('');
  const [captchaReset, setCaptchaReset] = useState(0);
  // Registration always needs a CAPTCHA; sign-in only after the API asks for one (repeated failed attempts).
  const [loginNeedsCaptcha, setLoginNeedsCaptcha] = useState(false);
  const showCaptcha = mode === 'register' || loginNeedsCaptcha;

  function switchMode(next) {
    setMode(next);
    setCaptchaToken('');
    setFields({});
    setError('');
  }

  async function submit(event) {
    event.preventDefault();
    // Read the form now: event.currentTarget is cleared once the handler awaits.
    const formElement = event.currentTarget;
    if (showCaptcha && !captchaToken) {
      setError('Please complete the security check first.');
      return;
    }
    setBusy(true);
    setFields({});
    setError('');
    const body = Object.fromEntries(new FormData(formElement).entries());
    if (showCaptcha) body.captchaToken = captchaToken;
    try {
      if (mode === 'register') {
        delete body.confirmPassword;
        const result = await api('/api/auth/register', { method: 'POST', body, token: null });
        setNotice(`${result.message}. We sent a verification link to ${body.email}. Sign in to continue.`);
        switchMode('login');
        formElement.reset();
      } else {
        const result = await api('/api/auth/login', { method: 'POST', body, token: null });
        saveToken(result.token);
        onAuthenticated(result.user);
        setNotice(`Welcome, ${result.user.name}.`);
      }
    } catch (error) {
      setError(friendlyError(error));
      setFields(error.fields || {});
      if (mode === 'login' && captchaNeeded(error)) setLoginNeedsCaptcha(true);
    } finally {
      setBusy(false);
      if (showCaptcha) {
        // CAPTCHA tokens work once, so a new challenge is needed for the next attempt.
        setCaptchaToken('');
        setCaptchaReset((value) => value + 1);
      }
    }
  }

  return (
    <section className="auth-card">
      <div className="segmented">
        <button className={mode === 'login' ? 'selected' : ''} type="button" onClick={() => switchMode('login')}>Sign in</button>
        <button className={mode === 'register' ? 'selected' : ''} type="button" onClick={() => switchMode('register')}>Create account</button>
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
        {mode === 'login' && loginNeedsCaptcha && <p className="hint">For your security, please complete this check before signing in.</p>}
        {showCaptcha && <Captcha key={mode} onToken={setCaptchaToken} resetSignal={captchaReset} />}
        {showCaptcha && !captchaToken && <p className="hint">Complete the security check to continue.</p>}
        <button className="primary full" type="submit" disabled={busy || (showCaptcha && !captchaToken)}>{busy ? 'Please wait…' : mode === 'login' ? 'Sign in' : 'Create account'}</button>
      </form>
    </section>
  );
}
