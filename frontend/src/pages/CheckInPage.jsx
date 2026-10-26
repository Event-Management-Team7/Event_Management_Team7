import { useState } from 'react';
import { api } from '../api.js';
import Message from '../components/Message.jsx';

export default function CheckInPage() {
  const [ticketCode, setTicketCode] = useState('');
  const [result, setResult] = useState(null);

  async function checkIn(event) {
    event.preventDefault();
    setResult(null);
    try {
      const response = await api('/api/tickets/checkin', {
        method: 'POST',
        body: { ticketCode: ticketCode.trim() }
      });
      setResult({ success: true, text: `${response.attendeeName} checked in for ${response.eventTitle}.` });
      setTicketCode('');
    } catch (requestError) {
      setResult({ success: false, text: requestError.message });
    }
  }

  return (
    <section className="card checkin">
      <span className="eyebrow">ORGANIZER TOOL</span>
      <h2>Ticket check-in</h2>
      <p>Enter a ticket code to validate and admit the attendee.</p>
      <form onSubmit={checkIn}>
        <input aria-label="Ticket code" value={ticketCode} onChange={(event) => setTicketCode(event.target.value)} placeholder="EMRS-a1b2c3d4" required />
        <button className="primary" type="submit">Check in</button>
      </form>
      {result && <Message message={result.text} kind={result.success ? 'success' : 'error'} />}
    </section>
  );
}
