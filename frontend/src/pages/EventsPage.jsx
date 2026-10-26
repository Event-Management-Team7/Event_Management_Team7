import { useCallback, useEffect, useState } from 'react';
import { api } from '../api.js';
import { CATEGORIES } from '../constants.js';
import EventCard from '../components/EventCard.jsx';
import useEventActions from '../hooks/useEventActions.js';

export default function EventsPage({ user, notify, setEventCount }) {
  const [events, setEvents] = useState([]);
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('');
  const [loading, setLoading] = useState(false);

  const loadEvents = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (category) params.set('category', category);
      if (search.trim()) params.set('search', search.trim());
      const result = await api(`/api/events${params.size ? `?${params}` : ''}`, { token: null });
      setEvents(result.events);
      setEventCount(result.events.length);
    } catch (requestError) {
      notify.setError(requestError.message);
    } finally {
      setLoading(false);
    }
  }, [category, search, notify, setEventCount]);

  useEffect(() => { loadEvents(); }, [loadEvents]);

  const { registerForEvent, cancelEvent } = useEventActions({ notify, reload: loadEvents });

  return (
    <section>
      <div className="section-heading"><div><span className="eyebrow">DISCOVER</span><h2>Upcoming events</h2></div></div>
      <div className="filters">
        <input aria-label="Search events" placeholder="Search title, description, or venue" value={search} onChange={(event) => setSearch(event.target.value)} />
        <select aria-label="Filter category" value={category} onChange={(event) => setCategory(event.target.value)}>
          <option value="">All categories</option>
          {CATEGORIES.map((item) => <option key={item}>{item}</option>)}
        </select>
      </div>
      {loading ? <p className="loading">Loading events…</p> : events.length ? (
        <div className="grid">{events.map((event) => (
          <EventCard key={event.id} event={event} user={user} onRegister={registerForEvent} onCancel={cancelEvent} />
        ))}</div>
      ) : <p className="empty">No events match your search.</p>}
    </section>
  );
}
