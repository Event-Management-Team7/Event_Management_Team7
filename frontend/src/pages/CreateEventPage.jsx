import { useState } from 'react';
import { api } from '../api.js';
import EventForm from '../components/EventForm.jsx';

export default function CreateEventPage({ notify, setTab }) {
  const [busy, setBusy] = useState(false);

  async function createEvent(payload, form) {
    setBusy(true);
    notify.dismiss();
    try {
      const result = await api('/api/events', { method: 'POST', body: payload });
      notify.setNotice(`${result.message} (event ${result.eventId})`);
      form.reset();
      setTab('mine');
    } catch (requestError) {
      notify.setError(Object.values(requestError.fields || {}).join(' ') || requestError.message);
    } finally {
      setBusy(false);
    }
  }

  return <EventForm onCreate={createEvent} busy={busy} />;
}
