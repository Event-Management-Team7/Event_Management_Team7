import { useState } from 'react';
import { CATEGORIES } from '../constants.js';

export default function EventForm({ onCreate, busy }) {
  const [venueType, setVenueType] = useState('Physical');
  return (
    <form className="card form-grid" onSubmit={(event) => {
      event.preventDefault();
      const form = new FormData(event.currentTarget);
      onCreate({
        title: form.get('title'),
        description: form.get('description'),
        category: form.get('category'),
        startDateTime: form.get('startDateTime'),
        endDateTime: form.get('endDateTime'),
        venueType,
        address: venueType === 'Physical' ? form.get('address') : '',
        meetingLink: venueType === 'Virtual' ? form.get('meetingLink') : '',
        capacity: Number(form.get('capacity')),
        ticketTypes: [{ name: form.get('ticketName'), price: Number(form.get('ticketPrice') || 0) }],
        currency: form.get('currency'),
        tags: String(form.get('tags') || '').split(',').map((tag) => tag.trim()).filter(Boolean)
      }, event.currentTarget);
    }}>
      <h2>Create event</h2>
      <label>Title<input name="title" required minLength="3" maxLength="100" /></label>
      <div className="form-row">
        <label>Category<select name="category">{CATEGORIES.map((category) => <option key={category}>{category}</option>)}</select></label>
        <label>Venue type<select name="venueType" value={venueType} onChange={(event) => setVenueType(event.target.value)}><option>Physical</option><option>Virtual</option></select></label>
      </div>
      <div className="form-row">
        <label>Start date and time<input name="startDateTime" type="datetime-local" required /></label>
        <label>End date and time<input name="endDateTime" type="datetime-local" required /></label>
      </div>
      <div className="form-row">
        {venueType === 'Physical'
          ? <label>Venue / address<input name="address" required minLength="3" maxLength="200" /></label>
          : <label>HTTPS meeting link<input name="meetingLink" type="url" required placeholder="https://..." /></label>}
        <label>Capacity<input name="capacity" type="number" min="1" defaultValue="50" required /></label>
      </div>
      <div className="form-row">
        <label>Ticket type name<input name="ticketName" required maxLength="50" defaultValue="General Admission" /></label>
        <label>Ticket price<input name="ticketPrice" type="number" min="0" step="0.01" defaultValue="0" required /></label>
      </div>
      <div className="form-row">
        <label>Currency<input name="currency" defaultValue="INR" /></label>
        <label>Tags (comma-separated)<input name="tags" placeholder="community, learning" /></label>
      </div>
      <label>Description<textarea name="description" rows="4" required maxLength="2000" /></label>
      <button className="primary" type="submit" disabled={busy}>{busy ? 'Publishing…' : 'Publish event'}</button>
    </form>
  );
}
