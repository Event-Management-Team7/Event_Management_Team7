import { formatDate } from '../utils.js';

export default function EventCard({ event, user, onRegister, onCancel }) {
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
