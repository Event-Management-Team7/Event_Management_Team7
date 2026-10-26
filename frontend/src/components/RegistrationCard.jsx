import { formatDate } from '../utils.js';

export default function RegistrationCard({ registration, onCancel }) {
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
