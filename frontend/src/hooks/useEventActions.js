import { api } from '../api.js';

// Register / cancel-event handlers shared by every page that renders EventCard.
// `reload` refreshes the calling page's own list afterwards.
export default function useEventActions({ notify, reload, setBusy = () => {} }) {
  async function registerForEvent(event) {
    setBusy(true);
    notify.dismiss();
    try {
      const result = await api(`/api/events/${event.id}/register`, { method: 'POST' });
      notify.setNotice(result.status === 'confirmed'
        ? `Registration confirmed. Ticket: ${result.ticketCode}`
        : 'You have been added to the waitlist.');
      await reload();
    } catch (requestError) {
      notify.setError(requestError.message);
    } finally {
      setBusy(false);
    }
  }

  async function cancelEvent(event) {
    if (!window.confirm(`Cancel "${event.title}"?`)) return;
    try {
      const result = await api(`/api/events/${event.id}`, { method: 'DELETE' });
      notify.setNotice(result.message);
      await reload();
    } catch (requestError) {
      notify.setError(requestError.message);
    }
  }

  return { registerForEvent, cancelEvent };
}
