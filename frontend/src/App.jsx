import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, clearToken, getToken, saveToken } from './api.js';

const CATEGORIES = ['Conference', 'Workshop', 'Concert', 'Sports', 'Networking', 'Other'];
const PRIVILEGED_ROLES = ['Organizer', 'Admin'];

function formatDate(date) {
  const parsed = new Date(date);
  return Number.isNaN(parsed.getTime()) ? date : parsed.toLocaleString();
}

function Message({ message, kind = 'info', onClose }) {
  if (!message) return null;
  return (
    <div className={`message ${kind}`} role={kind === 'error' ? 'alert' : 'status'}>
      <span>{message}</span>
      {onClose && <button type="button" aria-label="Dismiss message" onClick={onClose}>×</button>}
    </div>
  );
}

function AuthPanel({ onAuthenticated, setNotice, setError }) {
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
            <label>Full name<input name="name" autoComplete="name" required minLength="2" maxLength="60" /></label>
            <label>Phone (optional)<input name="phone" autoComplete="tel" inputMode="numeric" /></label>
            <p className="hint">New public accounts are created as Attendees.</p>
          </>
        )}
        <label>Email<input name="email" type="email" autoComplete="email" required /></label>
        <label>Password<input name="password" type="password" autoComplete={mode === 'login' ? 'current-password' : 'new-password'} required minLength={mode === 'register' ? 8 : undefined} /></label>
        {Object.entries(fields).map(([field, message]) => <small className="field-error" key={field}>{message}</small>)}
        <button className="primary full" type="submit" disabled={busy}>{busy ? 'Please wait…' : mode === 'login' ? 'Sign in' : 'Create account'}</button>
      </form>
    </section>
  );
}

function EventCard({ event, user, onRegister, onCancel }) {
  const canManage = user && (user.role === 'Admin' || (user.role === 'Organizer' && user.id === event.organizerId));
  return (
    <article className="card event-card">
      <div className="event-topline"><span className="tag">{event.category}</span><span>{event.price > 0 ? `₹${event.price}` : 'Free'}</span></div>
      <h3>{event.title}</h3>
      <p>{event.description}</p>
      <dl className="event-details">
        <div><dt>Date</dt><dd>{formatDate(event.date)}</dd></div>
        <div><dt>Venue</dt><dd>{event.venue}</dd></div>
        <div><dt>Capacity</dt><dd>{event.registeredCount} / {event.capacity}</dd></div>
      </dl>
      <div className="actions">
        {user && <button className="primary" type="button" onClick={() => onRegister(event)}>Register / waitlist</button>}
        {canManage && ['active', 'Upcoming'].includes(event.status) && <button className="danger" type="button" onClick={() => onCancel(event)}>Cancel event</button>}
      </div>
    </article>
  );
}

function EventForm({ onCreate, busy }) {
  const [venueType, setVenueType] = useState('Physical');
  return (
    <form className="card form-grid" onSubmit={(event) => {
      event.preventDefault();
      const form = new FormData(event.currentTarget);
      onCreate({
        title: form.get('title'),
        description: form.get('description'),
        category: form.get('category'),
        startDateTime: form.get('startDateTime'),
        endDateTime: form.get('endDateTime'),
        venueType,
        address: venueType === 'Physical' ? form.get('address') : '',
        meetingLink: venueType === 'Virtual' ? form.get('meetingLink') : '',
        capacity: Number(form.get('capacity')),
        ticketTypes: [{ name: form.get('ticketName'), price: Number(form.get('ticketPrice') || 0) }],
        currency: form.get('currency'),
        tags: String(form.get('tags') || '').split(',').map((tag) => tag.trim()).filter(Boolean)
      }, event.currentTarget);
    }}>
      <h2>Create event</h2>
      <label>Title<input name="title" required minLength="3" maxLength="100" /></label>
      <div className="form-row">
        <label>Category<select name="category">{CATEGORIES.map((category) => <option key={category}>{category}</option>)}</select></label>
        <label>Venue type<select name="venueType" value={venueType} onChange={(event) => setVenueType(event.target.value)}><option>Physical</option><option>Virtual</option></select></label>
      </div>
      <div className="form-row">
        <label>Start date and time<input name="startDateTime" type="datetime-local" required /></label>
        <label>End date and time<input name="endDateTime" type="datetime-local" required /></label>
      </div>
      <div className="form-row">
        {venueType === 'Physical'
          ? <label>Venue / address<input name="address" required minLength="3" maxLength="200" /></label>
          : <label>HTTPS meeting link<input name="meetingLink" type="url" required placeholder="https://..." /></label>}
        <label>Capacity<input name="capacity" type="number" min="1" defaultValue="50" required /></label>
      </div>
      <div className="form-row">
        <label>Ticket type name<input name="ticketName" required maxLength="50" defaultValue="General Admission" /></label>
        <label>Ticket price<input name="ticketPrice" type="number" min="0" step="0.01" defaultValue="0" required /></label>
      </div>
      <div className="form-row">
        <label>Currency<input name="currency" defaultValue="INR" /></label>
        <label>Tags (comma-separated)<input name="tags" placeholder="community, learning" /></label>
      </div>
      <label>Description<textarea name="description" rows="4" required maxLength="2000" /></label>
      <button className="primary" type="submit" disabled={busy}>{busy ? 'Publishing…' : 'Publish event'}</button>
    </form>
  );
}

function RegistrationCard({ registration, onCancel }) {
  return (
    <article className="card registration-card">
      <div className="event-topline"><span className={`tag ${registration.status}`}>{registration.status}</span><span>{formatDate(registration.createdAt * 1000)}</span></div>
      <h3>{registration.eventTitle}</h3>
      {registration.ticketCode ? (
        <div className="ticket">
          <span>Ticket code</span>
          <code>{registration.ticketCode.toUpperCase()}</code>
          <small>Show this code to an organizer for check-in.</small>
        </div>
      ) : <p>You are on the waitlist. A ticket is issued if a place becomes available.</p>}
      <button className="danger" type="button" onClick={() => onCancel(registration)}>Cancel registration</button>
    </article>
  );
}

export default function App() {
  const [user, setUser] = useState(null);
  const [authReady, setAuthReady] = useState(false);
  const [tab, setTab] = useState('events');
  const [events, setEvents] = useState([]);
  const [organizerEvents, setOrganizerEvents] = useState([]);
  const [registrations, setRegistrations] = useState([]);
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('');
  const [ticketCode, setTicketCode] = useState('');
  const [checkInResult, setCheckInResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const [loadingEvents, setLoadingEvents] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const canOrganize = Boolean(user && PRIVILEGED_ROLES.includes(user.role));
  const canCreate = Boolean(user && user.role === 'Organizer');
  const dismissMessages = useCallback(() => {
    setError('');
    setNotice('');
  }, []);

  const loadEvents = useCallback(async () => {
    setLoadingEvents(true);
    try {
      const params = new URLSearchParams();
      if (category) params.set('category', category);
      if (search.trim()) params.set('search', search.trim());
      const result = await api(`/api/events${params.size ? `?${params}` : ''}`, { token: null });
      setEvents(result.events);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setLoadingEvents(false);
    }
  }, [category, search]);

  const loadPrivateData = useCallback(async (activeUser) => {
    if (!activeUser) {
      setOrganizerEvents([]);
      setRegistrations([]);
      return;
    }
    try {
      const [registrationResult, eventResult] = await Promise.all([
        api('/api/registrations/my'),
        PRIVILEGED_ROLES.includes(activeUser.role) ? api('/api/events/mine') : Promise.resolve({ events: [] })
      ]);
      setRegistrations(registrationResult.registrations);
      setOrganizerEvents(eventResult.events);
    } catch (requestError) {
      setError(requestError.message);
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
        if (active) {
          setUser(result.user);
          await loadPrivateData(result.user);
        }
      } catch {
        clearToken();
      } finally {
        if (active) setAuthReady(true);
      }
    }
    restoreSession();
    return () => { active = false; };
  }, [loadPrivateData]);

  useEffect(() => { loadEvents(); }, [loadEvents]);

  const eventTitle = useMemo(() => tab === 'mine' ? "Organizer's events" : 'Upcoming events', [tab]);

  async function refreshPrivateData() {
    await loadPrivateData(user);
  }

  async function handleRegister(event) {
    setBusy(true);
    dismissMessages();
    try {
      const result = await api(`/api/events/${event.id}/register`, { method: 'POST' });
      setNotice(result.status === 'confirmed'
        ? `Registration confirmed. Ticket: ${result.ticketCode}`
        : 'You have been added to the waitlist.');
      await Promise.all([loadEvents(), refreshPrivateData()]);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setBusy(false);
    }
  }

  async function createEvent(payload, form) {
    setBusy(true);
    dismissMessages();
    try {
      const result = await api('/api/events', { method: 'POST', body: payload });
      setNotice(`${result.message} (event ${result.eventId})`);
      form.reset();
      setTab('mine');
      await Promise.all([loadEvents(), refreshPrivateData()]);
    } catch (requestError) {
      setError(Object.values(requestError.fields || {}).join(' ') || requestError.message);
    } finally {
      setBusy(false);
    }
  }

  async function cancelRegistration(registration) {
    if (!window.confirm(`Cancel your registration for "${registration.eventTitle}"?`)) return;
    try {
      const result = await api(`/api/registrations/${registration.id}`, { method: 'DELETE' });
      setNotice(result.message);
      await Promise.all([refreshPrivateData(), loadEvents()]);
    } catch (requestError) {
      setError(requestError.message);
    }
  }

  async function cancelEvent(event) {
    if (!window.confirm(`Cancel "${event.title}"?`)) return;
    try {
      const result = await api(`/api/events/${event.id}`, { method: 'DELETE' });
      setNotice(result.message);
      await Promise.all([loadEvents(), refreshPrivateData()]);
    } catch (requestError) {
      setError(requestError.message);
    }
  }

  async function checkIn(event) {
    event.preventDefault();
    setCheckInResult(null);
    try {
      const result = await api('/api/tickets/checkin', {
        method: 'POST',
        body: { ticketCode: ticketCode.trim() }
      });
      setCheckInResult({ success: true, text: `${result.attendeeName} checked in for ${result.eventTitle}.` });
      setTicketCode('');
    } catch (requestError) {
      setCheckInResult({ success: false, text: requestError.message });
    }
  }

  async function logout() {
    try {
      await api('/api/auth/logout', { method: 'POST' });
    } catch {
      // Clear local auth state even if the API is unreachable; the token can no longer be used here.
    }
    clearToken();
    setUser(null);
    setOrganizerEvents([]);
    setRegistrations([]);
    setTab('events');
    setNotice('You have been signed out.');
  }

  function acceptLogin(nextUser) {
    setUser(nextUser);
    setAuthReady(true);
    loadPrivateData(nextUser);
  }

  if (!authReady) {
    return <main className="shell"><p className="loading">Checking your session…</p></main>;
  }

  return (
    <div className="shell">
      <header className="header">
        <a href="#" className="brand" onClick={(event) => { event.preventDefault(); setTab('events'); }}>
          <span className="brand-mark">E</span><span><strong>EMRS</strong><small>Event management</small></span>
        </a>
        <nav aria-label="Main navigation">
          <button className={tab === 'events' ? 'active' : ''} onClick={() => setTab('events')}>Events</button>
          {canCreate && <button className={tab === 'create' ? 'active' : ''} onClick={() => setTab('create')}>Create event</button>}
          {canOrganize && <button className={tab === 'mine' ? 'active' : ''} onClick={() => setTab('mine')}>My events</button>}
          {user && <button className={tab === 'registrations' ? 'active' : ''} onClick={() => { setTab('registrations'); refreshPrivateData(); }}>My registrations</button>}
          {canOrganize && <button className={tab === 'checkin' ? 'active' : ''} onClick={() => setTab('checkin')}>Check-in</button>}
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
          <div className="welcome-count"><strong>{events.length}</strong><span>available events</span></div>
        </section>

        <Message message={error} kind="error" onClose={dismissMessages} />
        <Message message={notice} kind="success" onClose={dismissMessages} />

        {!user && <AuthPanel onAuthenticated={acceptLogin} setNotice={setNotice} setError={setError} />}

        {tab === 'events' && (
          <section>
            <div className="section-heading"><div><span className="eyebrow">DISCOVER</span><h2>{eventTitle}</h2></div></div>
            <div className="filters">
              <input aria-label="Search events" placeholder="Search title, description, or venue" value={search} onChange={(event) => setSearch(event.target.value)} />
              <select aria-label="Filter category" value={category} onChange={(event) => setCategory(event.target.value)}>
                <option value="">All categories</option>
                {CATEGORIES.map((item) => <option key={item}>{item}</option>)}
              </select>
            </div>
            {loadingEvents ? <p className="loading">Loading events…</p> : events.length ? (
              <div className="grid">{events.map((event) => (
                <EventCard key={event.id} event={event} user={user} onRegister={handleRegister} onCancel={cancelEvent} />
              ))}</div>
            ) : <p className="empty">No events match your search.</p>}
          </section>
        )}

        {tab === 'create' && canCreate && <EventForm onCreate={createEvent} busy={busy} />}

        {tab === 'mine' && canOrganize && (
          <section>
            <div className="section-heading"><div><span className="eyebrow">ORGANIZER</span><h2>My events</h2></div></div>
            {organizerEvents.length ? <div className="grid">{organizerEvents.map((event) => (
              <EventCard key={event.id} event={event} user={user} onRegister={handleRegister} onCancel={cancelEvent} />
            ))}</div> : <p className="empty">You have not created any events yet.</p>}
          </section>
        )}

        {tab === 'registrations' && user && (
          <section>
            <div className="section-heading"><div><span className="eyebrow">YOUR ACCOUNT</span><h2>My registrations &amp; tickets</h2></div></div>
            {registrations.length ? <div className="grid">{registrations.map((registration) => (
              <RegistrationCard key={registration.id} registration={registration} onCancel={cancelRegistration} />
            ))}</div> : <p className="empty">You have no active registrations yet.</p>}
          </section>
        )}

        {tab === 'checkin' && canOrganize && (
          <section className="card checkin">
            <span className="eyebrow">ORGANIZER TOOL</span>
            <h2>Ticket check-in</h2>
            <p>Enter a ticket code to validate and admit the attendee.</p>
            <form onSubmit={checkIn}>
              <input aria-label="Ticket code" value={ticketCode} onChange={(event) => setTicketCode(event.target.value)} placeholder="EMRS-a1b2c3d4" required />
              <button className="primary" type="submit">Check in</button>
            </form>
            {checkInResult && <Message message={checkInResult.text} kind={checkInResult.success ? 'success' : 'error'} />}
          </section>
        )}
      </main>
      <footer>EMRS · Event management made simple</footer>
    </div>
  );
}
