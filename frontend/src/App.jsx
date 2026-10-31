import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, clearToken, getToken } from './api.js';
import AuthPanel from './components/AuthPanel.jsx';
import Message from './components/Message.jsx';
import VerificationBanner from './components/VerificationBanner.jsx';
import VerifyEmailPanel from './components/VerifyEmailPanel.jsx';
import { TABS } from './tabs.js';
import { parseVerificationToken } from './verification.js';

export default function App() {
  const [user, setUser] = useState(null);
  const [authReady, setAuthReady] = useState(false);
  const [tabId, setTab] = useState('events');
  const [eventCount, setEventCount] = useState(0);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  // The verification email links to <app>/#verify-email=<token>.
  const [verifyToken, setVerifyToken] = useState(() => parseVerificationToken(window.location.hash));

  const dismiss = useCallback(() => {
    setError('');
    setNotice('');
  }, []);
  const notify = useMemo(() => ({ setError, setNotice, dismiss }), [dismiss]);

  useEffect(() => {
    const onHashChange = () => setVerifyToken(parseVerificationToken(window.location.hash));
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  const closeVerification = useCallback(() => {
    // Remove the token from the address bar and history entry once it has been used.
    window.history.replaceState(null, '', window.location.pathname + window.location.search);
    setVerifyToken(null);
  }, []);

  // Re-read the signed-in user so the verification banner and gated features update right after verifying.
  const refreshUser = useCallback(async () => {
    const token = getToken();
    if (!token) return;
    try {
      const result = await api('/api/auth/me', { token });
      setUser(result.user);
    } catch {
      // An expired session is handled the next time the page loads.
    }
  }, []);

  useEffect(() => {
    let active = true;
    async function restoreSession() {
      const token = getToken();
      if (!token) {
        setAuthReady(true);
        return;
      }
      try {
        const result = await api('/api/auth/me', { token });
        if (active) setUser(result.user);
      } catch {
        clearToken();
      } finally {
        if (active) setAuthReady(true);
      }
    }
    restoreSession();
    return () => { active = false; };
  }, []);

  async function logout() {
    try {
      await api('/api/auth/logout', { method: 'POST' });
    } catch {
      // Clear local auth state even if the API is unreachable; the token can no longer be used here.
    }
    clearToken();
    setUser(null);
    setTab('events');
    setNotice('You have been signed out.');
  }

  function acceptLogin(nextUser) {
    setUser(nextUser);
    setAuthReady(true);
  }

  if (!authReady) {
    return <main className="shell"><p className="loading">Checking your session…</p></main>;
  }

  const visibleTabs = TABS.filter((tab) => tab.visible(user));
  const activeTab = visibleTabs.find((tab) => tab.id === tabId) || visibleTabs[0];
  const Page = activeTab.page;

  return (
    <div className="shell">
      <header className="header">
        <a href="#" className="brand" onClick={(event) => { event.preventDefault(); setTab('events'); }}>
          <span className="brand-mark">E</span><span><strong>EMRS</strong><small>Event management</small></span>
        </a>
        <nav aria-label="Main navigation">
          {visibleTabs.map((tab) => (
            <button key={tab.id} className={tab.id === activeTab.id ? 'active' : ''} onClick={() => setTab(tab.id)}>{tab.label}</button>
          ))}
        </nav>
        <div className="user-area">
          {user ? <>
            <span className="identity">{user.name} <small>{user.role}</small></span>
            <button className="outline" onClick={logout}>Log out</button>
          </> : <span className="identity signed-out">Not signed in</span>}
        </div>
      </header>

      <main>
        <section className="welcome">
          <div>
            <span className="eyebrow">EVENT MANAGEMENT &amp; REGISTRATION SYSTEM</span>
            <h1>Find your next event.</h1>
            <p>Discover events, register, and manage your tickets in one place.</p>
          </div>
          <div className="welcome-count"><strong>{eventCount}</strong><span>available events</span></div>
        </section>

        <Message message={error} kind="error" onClose={dismiss} />
        <Message message={notice} kind="success" onClose={dismiss} />

        {verifyToken && <VerifyEmailPanel token={verifyToken} user={user} onClose={closeVerification} onVerified={refreshUser} />}
        {!verifyToken && <VerificationBanner user={user} onVerified={refreshUser} />}

        {!user && <AuthPanel onAuthenticated={acceptLogin} setNotice={setNotice} setError={setError} />}

        <Page key={activeTab.id} user={user} notify={notify} setTab={setTab} setEventCount={setEventCount} />
      </main>
      <footer>EMRS · Event management made simple</footer>
    </div>
  );
}
