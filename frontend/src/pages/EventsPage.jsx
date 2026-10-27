import { useCallback, useEffect, useState } from 'react';
import { api } from '../api.js';
import { CATEGORIES } from '../constants.js';
import EventCard from '../components/EventCard.jsx';
import useEventActions from '../hooks/useEventActions.js';

export default function EventsPage({ user, notify, setEventCount }) {
  const [events, setEvents] = useState([]);
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [location, setLocation] = useState('');
  const [loading, setLoading] = useState(false);

  const loadEvents = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (category) params.set('category', category);
      if (search.trim()) params.set('search', search.trim());
      if (from) params.set('from', from);
      if (to) params.set('to', to);
      if (location.trim()) params.set('location', location.trim());
      const result = await api(`/api/events${params.size ? `?${params}` : ''}`, { token: null });
      setEvents(result.events);
      setEventCount(result.events.length);
    } catch (requestError) {
      notify.setError(requestError.message);
    } finally {
      setLoading(false);
    }
  }, [category, search, from, to, location, notify, setEventCount]);

  useEffect(() => { loadEvents(); }, [loadEvents]);

  const hasFilters = Boolean(search || category || from || to || location);
  function clearFilters() {
    setSearch('');
    setCategory('');
    setFrom('');
    setTo('');
    setLocation('');
  }

  const { registerForEvent, cancelEvent } = useEventActions({ notify, reload: loadEvents });

  return (
    <section>
      <div className="section-heading"><div><span className="eyebrow">DISCOVER</span><h2>Upcoming events</h2></div></div>
      <form className="filters" role="search" aria-label="Filter events" onSubmit={(event) => event.preventDefault()}>
        <input aria-label="Search events" placeholder="Search title, description, or venue" value={search} onChange={(event) => setSearch(event.target.value)} />
        <select aria-label="Filter category" value={category} onChange={(event) => setCategory(event.target.value)}>
          <option value="">All categories</option>
          {CATEGORIES.map((item) => <option key={item}>{item}</option>)}
        </select>
        <label className="filter-field">From
          <input type="date" value={from} max={to || undefined} onChange={(event) => setFrom(event.target.value)} />
        </label>
        <label className="filter-field">To
          <input type="date" value={to} min={from || undefined} onChange={(event) => setTo(event.target.value)} />
        </label>
        <label className="filter-field filter-location">Location
          <input type="search" placeholder="e.g. Hall A" value={location} onChange={(event) => setLocation(event.target.value)} />
        </label>
        <button type="button" className="outline" onClick={clearFilters} disabled={!hasFilters}>Clear</button>
      </form>
      {loading ? <p className="loading">Loading events…</p> : events.length ? (
        <div className="grid">{events.map((event) => (
          <EventCard key={event.id} event={event} user={user} onRegister={registerForEvent} onCancel={cancelEvent} />
        ))}</div>
      ) : <p className="empty">No events match your filters.</p>}
    </section>
  );
}
