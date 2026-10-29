import { useState } from 'react';
import { canManageEvent, isCancelled } from '../eventForm.js';
import { formatDate } from '../utils.js';
import ConfirmDialog from './ConfirmDialog.jsx';

export default function EventCard({ event, user, onRegister, onCancel, onEdit }) {
  const [confirming, setConfirming] = useState(false);
  const cancelled = isCancelled(event);
  const manageable = canManageEvent(event, user);
  return (
    <article className={`card event-card${cancelled ? ' cancelled' : ''}`}>
      <div className="event-topline"><span className="tag">{event.category}</span><span>{event.price > 0 ? `₹${event.price}` : 'Free'}</span></div>
      <h3>{event.title}{cancelled && <span className="badge-cancelled">Cancelled</span>}</h3>
      <p>{event.description}</p>
      <dl className="event-details">
        <div><dt>Date</dt><dd>{formatDate(event.date)}</dd></div>
        <div><dt>Venue</dt><dd>{event.venue}</dd></div>
        <div><dt>Capacity</dt><dd>{event.registeredCount} / {event.capacity}</dd></div>
      </dl>
      {cancelled && <p className="cancelled-note">This event was cancelled. Registration is closed.</p>}
      <div className="actions">
        {user && !cancelled && <button className="primary" type="button" onClick={() => onRegister(event)}>Register / waitlist</button>}
        {manageable && onEdit && (
          <button className="outline" type="button" data-edit-button={event.id} aria-label={`Edit ${event.title}`} onClick={() => onEdit(event)}>Edit</button>
        )}
        {manageable && (
          <button className="danger" type="button" aria-label={`Cancel event ${event.title}`} onClick={() => setConfirming(true)}>Cancel event</button>
        )}
      </div>
      {confirming && (
        <ConfirmDialog
          title="Cancel this event?"
          message={`“${event.title}” will be cancelled. Registered attendees will be emailed.`}
          confirmLabel="Yes, cancel event"
          dismissLabel="Keep event"
          onClose={() => setConfirming(false)}
          onConfirm={() => { setConfirming(false); onCancel(event); }}
        />
      )}
    </article>
  );
}
