import { useCallback, useEffect, useState } from 'react';
import { api } from '../api.js';
import RegistrationCard from '../components/RegistrationCard.jsx';

export default function MyRegistrationsPage({ notify }) {
  const [registrations, setRegistrations] = useState([]);

  const load = useCallback(async () => {
    try {
      const result = await api('/api/registrations/my');
      setRegistrations(result.registrations);
    } catch (requestError) {
      notify.setError(requestError.message);
    }
  }, [notify]);

  useEffect(() => { load(); }, [load]);

  async function cancelRegistration(registration) {
    if (!window.confirm(`Cancel your registration for "${registration.eventTitle}"?`)) return;
    try {
      const result = await api(`/api/registrations/${registration.id}`, { method: 'DELETE' });
      notify.setNotice(result.message);
      await load();
    } catch (requestError) {
      notify.setError(requestError.message);
    }
  }

  return (
    <section>
      <div className="section-heading"><div><span className="eyebrow">YOUR ACCOUNT</span><h2>My registrations &amp; tickets</h2></div></div>
      {registrations.length ? <div className="grid">{registrations.map((registration) => (
        <RegistrationCard key={registration.id} registration={registration} onCancel={cancelRegistration} />
      ))}</div> : <p className="empty">You have no active registrations yet.</p>}
    </section>
  );
}
