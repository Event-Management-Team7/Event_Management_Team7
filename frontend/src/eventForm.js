import { CATEGORIES } from './constants.js';

export const EMPTY_EVENT_VALUES = {
  title: '',
  description: '',
  category: CATEGORIES[0],
  venueType: 'Physical',
  startDateTime: '',
  endDateTime: '',
  address: '',
  meetingLink: '',
  capacity: 50,
  ticketName: 'General Admission',
  ticketPrice: 0,
  currency: 'INR',
  tags: ''
};

// Backend field-error keys that belong to each form input, so API errors show next to the field.
export const ERROR_KEYS = {
  title: ['title'],
  category: ['category'],
  venueType: ['venueType'],
  startDateTime: ['startDateTime'],
  endDateTime: ['endDateTime'],
  address: ['venue'],
  meetingLink: ['meetingLink'],
  capacity: ['capacity'],
  ticketName: ['ticketTypes', 'ticketTypes.0.name'],
  ticketPrice: ['ticketTypes.0.price', 'ticketTypes.0.quantity'],
  currency: ['currency'],
  tags: ['tags'],
  description: ['description']
};

export function fieldMessage(errors, name) {
  const keys = ERROR_KEYS[name] || [];
  for (const key of Object.keys(errors || {})) {
    if (keys.includes(key) || (name === 'tags' && key.startsWith('tags.'))) return errors[key];
  }
  return '';
}

// Errors the form has no input for (e.g. a second ticket type), shown in the form summary.
export function unmappedMessages(errors) {
  return Object.entries(errors || {})
    .filter(([key]) => !Object.values(ERROR_KEYS).some((keys) => keys.includes(key)) && !key.startsWith('tags.'))
    .map(([, message]) => message);
}

export function isCancelled(event) {
  return String(event?.status ?? '').toLowerCase() === 'cancelled';
}

export function hasStarted(event, now = Date.now()) {
  const start = Date.parse(event?.startDateTime || event?.date);
  return Number.isFinite(start) && start <= now;
}

// Edit and Cancel are for the owning organizer (or an admin), and only while the event is
// still upcoming: never for attendees, logged-out visitors, cancelled or already-started events.
export function canManageEvent(event, user, now = Date.now()) {
  if (!user || !event) return false;
  const owns = user.role === 'Admin' || (user.role === 'Organizer' && user.id === event.organizerId);
  const open = ['active', 'upcoming'].includes(String(event.status).toLowerCase());
  return owns && open && !hasStarted(event, now);
}

// <input type="datetime-local"> needs "YYYY-MM-DDTHH:mm".
function toDateTimeLocal(value) {
  return typeof value === 'string' ? value.slice(0, 16) : '';
}

export function eventToFormValues(event) {
  const firstTicket = event.ticketTypes?.[0] ?? {};
  const virtual = event.venueType === 'Virtual';
  return {
    title: event.title ?? '',
    description: event.description ?? '',
    category: event.category ?? CATEGORIES[0],
    venueType: virtual ? 'Virtual' : 'Physical',
    startDateTime: toDateTimeLocal(event.startDateTime),
    endDateTime: toDateTimeLocal(event.endDateTime),
    address: virtual ? '' : (event.venue ?? ''),
    meetingLink: event.meetingLink ?? '',
    capacity: event.capacity ?? EMPTY_EVENT_VALUES.capacity,
    ticketName: firstTicket.name ?? EMPTY_EVENT_VALUES.ticketName,
    ticketPrice: firstTicket.price ?? event.price ?? 0,
    currency: event.currency ?? 'INR',
    tags: (event.tags ?? []).join(', ')
  };
}

// Turns the raw form values into the body for POST /api/events and PUT /api/events/:id.
// When editing an event that has several ticket types, the others are sent back unchanged
// because the form only edits the first one.
export function buildEventPayload(values, venueType, existing) {
  const name = values.ticketName;
  const price = Number(values.ticketPrice || 0);
  const existingTickets = existing?.ticketTypes ?? [];
  const ticketTypes = existingTickets.length > 1
    ? [{ ...existingTickets[0], name, price }, ...existingTickets.slice(1)]
    : [{ name, price }];
  return {
    title: values.title,
    description: values.description,
    category: values.category,
    startDateTime: values.startDateTime,
    endDateTime: values.endDateTime,
    venueType,
    address: venueType === 'Physical' ? values.address : '',
    meetingLink: venueType === 'Virtual' ? values.meetingLink : '',
    capacity: Number(values.capacity),
    ticketTypes,
    currency: values.currency,
    tags: String(values.tags || '').split(',').map((tag) => tag.trim()).filter(Boolean)
  };
}
