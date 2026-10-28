import { useCallback, useEffect, useState } from 'react';
import { api } from '../api.js';
import EventCard from '../components/EventCard.jsx';
import useEventActions from '../hooks/useEventActions.js';

export default function MyEventsPage({ user, notify }) {
  const [events, setEvents] = useState([]);

  const load = useCallback(async () => {
    try {
      const result = await api('/api/events/mine');
      setEvents(result.events);
    } catch (requestError) {
      notify.setError(requestError.message);
    }
  }, [notify]);

  useEffect(() => { load(); }, [load]);

  const { registerForEvent, cancelEvent } = useEventActions({ notify, reload: load });

  return (
    <section>
      <div className="section-heading"><div><span className="eyebrow">ORGANIZER</span><h2>My events</h2></div></div>
      {events.length ? <div className="grid">{events.map((event) => (
        <EventCard key={event.id} event={event} user={user} onRegister={registerForEvent} onCancel={cancelEvent} />
      ))}</div> : <p className="empty">You have not created any events yet.</p>}
    </section>
  );
}
