import { useEffect, useRef, useState } from 'react';
import { CATEGORIES } from '../constants.js';
import { EMPTY_EVENT_VALUES, buildEventPayload, fieldMessage, unmappedMessages } from '../eventForm.js';

// Shared by Create event and Edit event. `errors` is the `fields` object from a 400 response;
// each message is shown next to its input and the first invalid input receives focus.
export default function EventForm({
  mode = 'create',
  initialValues = EMPTY_EVENT_VALUES,
  existing,
  errors = {},
  busy,
  onSubmit,
  onDiscard
}) {
  const [venueType, setVenueType] = useState(initialValues.venueType);
  const formRef = useRef(null);
  const editing = mode === 'edit';
  const extraMessages = unmappedMessages(errors);
  const hasErrors = Object.keys(errors).length > 0;

  useEffect(() => {
    if (hasErrors) formRef.current?.querySelector('[aria-invalid="true"]')?.focus();
  }, [errors, hasErrors]);

  // Props that tie an input to its inline error message.
  function field(name) {
    const message = fieldMessage(errors, name);
    return {
      id: `event-${name}`,
      name,
      'aria-invalid': message ? 'true' : undefined,
      'aria-describedby': message ? `event-${name}-error` : undefined
    };
  }
  function error(name) {
    const message = fieldMessage(errors, name);
    return message ? <span className="field-error" id={`event-${name}-error`}>{message}</span> : null;
  }

  return (
    <form ref={formRef} className="card form-grid" aria-label={editing ? 'Edit event' : 'Create event'} onSubmit={(event) => {
      event.preventDefault();
      const values = Object.fromEntries(new FormData(event.currentTarget));
      onSubmit(buildEventPayload(values, venueType, existing), event.currentTarget);
    }}>
      <h2>{editing ? 'Edit event' : 'Create event'}</h2>
      {hasErrors && (
        <div className="form-error-summary" role="alert">
          <strong>Please fix the highlighted fields.</strong>
          {extraMessages.map((message) => <span key={message}>{message}</span>)}
        </div>
      )}
      <label>Title<input {...field('title')} defaultValue={initialValues.title} required minLength="3" maxLength="100" autoFocus={editing} />{error('title')}</label>
      <div className="form-row">
        <label>Category<select {...field('category')} defaultValue={initialValues.category}>{CATEGORIES.map((category) => <option key={category}>{category}</option>)}</select>{error('category')}</label>
        <label>Venue type<select {...field('venueType')} value={venueType} onChange={(event) => setVenueType(event.target.value)}><option>Physical</option><option>Virtual</option></select>{error('venueType')}</label>
      </div>
      <div className="form-row">
        <label>Start date and time<input {...field('startDateTime')} type="datetime-local" defaultValue={initialValues.startDateTime} required />{error('startDateTime')}</label>
        <label>End date and time<input {...field('endDateTime')} type="datetime-local" defaultValue={initialValues.endDateTime} required />{error('endDateTime')}</label>
      </div>
      <div className="form-row">
        {venueType === 'Physical'
          ? <label>Venue / address<input {...field('address')} defaultValue={initialValues.address} required minLength="3" maxLength="200" />{error('address')}</label>
          : <label>HTTPS meeting link<input {...field('meetingLink')} type="url" defaultValue={initialValues.meetingLink} required placeholder="https://..." />{error('meetingLink')}</label>}
        <label>Capacity<input {...field('capacity')} type="number" min="1" defaultValue={initialValues.capacity} required />{error('capacity')}</label>
      </div>
      <div className="form-row">
        <label>Ticket type name<input {...field('ticketName')} required maxLength="50" defaultValue={initialValues.ticketName} />{error('ticketName')}</label>
        <label>Ticket price<input {...field('ticketPrice')} type="number" min="0" step="0.01" defaultValue={initialValues.ticketPrice} required />{error('ticketPrice')}</label>
      </div>
      <div className="form-row">
        <label>Currency<input {...field('currency')} defaultValue={initialValues.currency} />{error('currency')}</label>
        <label>Tags (comma-separated)<input {...field('tags')} defaultValue={initialValues.tags} placeholder="community, learning" />{error('tags')}</label>
      </div>
      <label>Description<textarea {...field('description')} rows="4" defaultValue={initialValues.description} required maxLength="2000" />{error('description')}</label>
      <div className="form-actions">
        <button className="primary" type="submit" disabled={busy}>
          {editing ? (busy ? 'Saving…' : 'Save changes') : (busy ? 'Publishing…' : 'Publish event')}
        </button>
        {editing && <button className="outline" type="button" onClick={onDiscard} disabled={busy}>Discard changes</button>}
      </div>
    </form>
  );
}
