import { PRIVILEGED_ROLES } from './constants.js';
import EventsPage from './pages/EventsPage.jsx';
import CreateEventPage from './pages/CreateEventPage.jsx';
import MyEventsPage from './pages/MyEventsPage.jsx';
import MyRegistrationsPage from './pages/MyRegistrationsPage.jsx';
import CheckInPage from './pages/CheckInPage.jsx';

const isPrivileged = (user) => Boolean(user && PRIVILEGED_ROLES.includes(user.role));

// To add a screen: create a file in pages/ and add one line here.
export const TABS = [
  { id: 'events', label: 'Events', visible: () => true, page: EventsPage },
  { id: 'create', label: 'Create event', visible: (user) => Boolean(user && user.role === 'Organizer'), page: CreateEventPage },
  { id: 'mine', label: 'My events', visible: isPrivileged, page: MyEventsPage },
  { id: 'registrations', label: 'My registrations', visible: (user) => Boolean(user), page: MyRegistrationsPage },
  { id: 'checkin', label: 'Check-in', visible: isPrivileged, page: CheckInPage }
];
