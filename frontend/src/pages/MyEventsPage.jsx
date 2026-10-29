import { useCallback, useEffect, useState } from 'react';
import { api } from '../api.js';
import EventCard from '../components/EventCard.jsx';
import EventForm from '../components/EventForm.jsx';
import { eventToFormValues } from '../eventForm.js';
import useEventActions from '../hooks/useEventActions.js';

export default function MyEventsPage({ user, notify }) {
  const [events, setEvents] = useState([]);
  const [editing, setEditing] = useState(null);
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);

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

  function startEdit(event) {
    notify.dismiss();
    setErrors({});
    setEditing(event);
  }

  function stopEdit() {
    const id = editing?.id;
    setEditing(null);
    setErrors({});
    // Put keyboard focus back on the Edit button that opened the form.
    requestAnimationFrame(() => document.querySelector(`[data-edit-button="${id}"]`)?.focus());
  }

  // Contract (EMT-15): PUT /api/events/:id takes the same body as POST /api/events and
  // returns 400 { error, fields } on invalid input.
  async function saveEvent(payload) {
    setBusy(true);
    notify.dismiss();
    setErrors({});
    try {
      const result = await api(`/api/events/${editing.id}`, { method: 'PUT', body: payload });
      notify.setNotice(result.message || 'Event updated.');
      await load();
      stopEdit();
    } catch (requestError) {
      const fields = requestError.fields || {};
      if (Object.keys(fields).length) setErrors(fields);
      else notify.setError(requestError.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section>
      <div className="section-heading"><div><span className="eyebrow">ORGANIZER</span><h2>My events</h2></div></div>
      {editing ? (
        <EventForm
          key={editing.id}
          mode="edit"
          existing={editing}
          initialValues={eventToFormValues(editing)}
          errors={errors}
          busy={busy}
          onSubmit={saveEvent}
          onDiscard={stopEdit}
        />
      ) : events.length ? <div className="grid">{events.map((event) => (
        <EventCard key={event.id} event={event} user={user} onRegister={registerForEvent} onCancel={cancelEvent} onEdit={startEdit} />
      ))}</div> : <p className="empty">You have not created any events yet.</p>}
    </section>
  );
}
