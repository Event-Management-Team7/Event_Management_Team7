import { useState } from 'react';
import { api } from '../api.js';
import EventForm from '../components/EventForm.jsx';

export default function CreateEventPage({ notify, setTab }) {
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState({});

  async function createEvent(payload, form) {
    setBusy(true);
    notify.dismiss();
    setErrors({});
    try {
      const result = await api('/api/events', { method: 'POST', body: payload });
      notify.setNotice(`${result.message} (event ${result.eventId})`);
      form.reset();
      setTab('mine');
    } catch (requestError) {
      const fields = requestError.fields || {};
      if (Object.keys(fields).length) setErrors(fields);
      else notify.setError(requestError.message);
    } finally {
      setBusy(false);
    }
  }

  return <EventForm mode="create" onSubmit={createEvent} errors={errors} busy={busy} />;
}
