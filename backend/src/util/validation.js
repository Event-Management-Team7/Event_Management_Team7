const EMAIL_PATTERN = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;
// Admin accounts are never self-registered; they are provisioned separately.
const REGISTRATION_ROLES = new Set(['Attendee', 'Organizer']);
const REGISTRATION_ROLE_ERROR = 'Role must be Attendee or Organizer.';

export function isObjectBody(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function validateRegistration(input) {
  const fields = {};
  const name = typeof input.name === 'string' ? input.name.trim() : '';
  const email = typeof input.email === 'string' ? input.email.trim() : '';
  const rawPhone = typeof input.phone === 'string' ? input.phone : '';
  const phone = rawPhone.trim();
  const password = typeof input.password === 'string' ? input.password : '';
  const role = typeof input.role === 'string' ? input.role.trim() : '';

  if (name.length < 2 || name.length > 50) {
    fields.name = 'Name must be 2-50 characters.';
  }
  if (!email || email.length > 254 || !EMAIL_PATTERN.test(email)) {
    fields.email = 'Please enter a valid email address.';
  }
  if (rawPhone && !/^[6-9]\d{9}$/.test(phone)) {
    fields.phone = 'Phone must be a valid 10-digit number.';
  }
  // bcrypt only uses the first 72 bytes, so longer passwords are rejected rather than silently truncated.
  if (
    password.length < 8 ||
    Buffer.byteLength(password, 'utf8') > 72 ||
    !/[A-Z]/.test(password) ||
    !/[a-z]/.test(password) ||
    !/\d/.test(password)
  ) {
    fields.password =
      'Password must be 8-72 characters long and contain an uppercase letter, a lowercase letter, and a digit.';
  }
  if (!REGISTRATION_ROLES.has(role)) fields.role = REGISTRATION_ROLE_ERROR;
  return fields;
}

const EVENT_CATEGORIES = new Set(['Conference', 'Workshop', 'Concert', 'Sports', 'Networking', 'Other']);
const DATE_TIME_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?(Z|[+-]\d{2}:\d{2})?$/;

function parseDateTime(value) {
  if (typeof value !== 'string') return null;
  const match = DATE_TIME_PATTERN.exec(value);
  if (!match) return null;

  const [, yearText, monthText, dayText, hourText, minuteText, secondText = '0', fractionText = '0', zone = ''] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const second = Number(secondText);
  const millisecond = Number(fractionText.padEnd(3, '0'));

  if (month < 1 || month > 12 || hour > 23 || minute > 59 || second > 59) return null;
  if (zone && zone !== 'Z') {
    const offsetHour = Number(zone.slice(1, 3));
    const offsetMinute = Number(zone.slice(4, 6));
    if (offsetHour > 23 || offsetMinute > 59) return null;
  }
  const calendarDate = new Date(0);
  calendarDate.setUTCFullYear(year, month - 1, day);
  calendarDate.setUTCHours(hour, minute, second, millisecond);
  if (
    calendarDate.getUTCFullYear() !== year ||
    calendarDate.getUTCMonth() !== month - 1 ||
    calendarDate.getUTCDate() !== day
  ) return null;

  const timestamp = zone
    ? Date.parse(value)
    : new Date(year, month - 1, day, hour, minute, second, millisecond).getTime();
  return Number.isFinite(timestamp) ? { timestamp, date: value.slice(0, 10), time: value.slice(11) } : null;
}

function decimalPlaces(value) {
  const [mantissa, exponentText] = String(value).toLowerCase().split('e');
  const fractionLength = (mantissa.split('.')[1] ?? '').length;
  return Math.max(0, fractionLength - Number(exponentText ?? 0));
}

function validHttpsUrl(value) {
  if (typeof value !== 'string' || !value.trim() || value !== value.trim()) return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && Boolean(url.hostname) && !url.username && !url.password;
  } catch (error) {
    if (error instanceof TypeError) return false;
    throw error;
  }
}

export function validateEvent(input, now = Date.now()) {
  const fields = {};
  const title = typeof input.title === 'string' ? input.title : '';
  const description = typeof input.description === 'string' ? input.description : '';
  const category = typeof input.category === 'string' ? input.category : '';
  const startDateTime = parseDateTime(input.startDateTime);
  const endDateTime = parseDateTime(input.endDateTime);
  const venueType = input.venueType;
  const venue = typeof input.venue === 'string' ? input.venue : '';
  const capacity = input.capacity;

  if (title.trim().length < 3 || title.trim().length > 100) {
    fields.title = 'Title must be 3-100 characters.';
  }
  if (description.trim().length < 1 || description.length > 2000) {
    fields.description = 'Description must be 1-2000 characters.';
  }
  if (!EVENT_CATEGORIES.has(category)) {
    fields.category = 'Category must be Conference, Workshop, Concert, Sports, Networking, or Other.';
  }
  if (!startDateTime) fields.startDateTime = 'Enter a valid start date and time.';
  else if (startDateTime.timestamp <= now) fields.startDateTime = 'Start date and time must be in the future.';
  if (!endDateTime) fields.endDateTime = 'Enter a valid end date and time.';
  else if (startDateTime && endDateTime.timestamp <= startDateTime.timestamp) {
    fields.endDateTime = 'End date and time must be after the start date and time.';
  }
  if (venueType !== 'Physical' && venueType !== 'Virtual') {
    fields.venueType = 'Venue type must be Physical or Virtual.';
  } else if (venueType === 'Physical' && (venue.trim().length < 3 || venue.trim().length > 200)) {
    fields.venue = 'Physical venue/address must be 3-200 characters.';
  }
  if (venueType === 'Virtual' && !validHttpsUrl(input.meetingLink)) {
    fields.meetingLink = 'A valid HTTPS meeting link is required for virtual events.';
  }
  if (!Number.isInteger(capacity) || capacity < 1 || capacity > 100000) {
    fields.capacity = 'Capacity must be an integer from 1 to 100000.';
  }

  const ticketTypes = input.ticketTypes;
  if (!Array.isArray(ticketTypes) || ticketTypes.length === 0) {
    fields.ticketTypes = 'At least one ticket type is required.';
  } else {
    let totalQuantity = 0;
    ticketTypes.forEach((ticket, index) => {
      const ticketField = `ticketTypes.${index}`;
      if (!isObjectBody(ticket)) {
        fields[ticketField] = 'Ticket type must be an object.';
        return;
      }
      const name = typeof ticket.name === 'string' ? ticket.name : '';
      if (name.trim().length < 1 || name.length > 50) {
        fields[`${ticketField}.name`] = 'Ticket name must be 1-50 characters.';
      }
      if (typeof ticket.price !== 'number' || !Number.isFinite(ticket.price) || ticket.price < 0) {
        fields[`${ticketField}.price`] = 'Ticket price must be a non-negative number.';
      } else if (decimalPlaces(ticket.price) > 2) {
        fields[`${ticketField}.price`] = 'Ticket price may have at most 2 decimal places.';
      }
      const quantity = ticket.quantity === undefined ? capacity : ticket.quantity;
      if (!Number.isInteger(quantity) || quantity < 1) {
        fields[`${ticketField}.quantity`] = 'Ticket quantity must be an integer of at least 1.';
      } else {
        totalQuantity += quantity;
      }
    });
    if (
      Number.isInteger(capacity) &&
      capacity >= 1 &&
      totalQuantity > capacity
    ) fields.ticketTypes = 'Total ticket quantities cannot exceed event capacity.';
  }

  if (input.currency !== undefined && (typeof input.currency !== 'string' || !input.currency.trim())) {
    fields.currency = 'Currency must be a non-empty string.';
  }
  if (!Array.isArray(input.tags)) {
    if (input.tags !== undefined) fields.tags = 'Tags must be an array.';
  } else {
    if (input.tags.length > 5) fields.tags = 'No more than 5 tags are allowed.';
    input.tags.forEach((tag, index) => {
      if (typeof tag !== 'string' || tag.length > 30) {
        fields[`tags.${index}`] = 'Each tag must be a string of at most 30 characters.';
      }
    });
  }
  return fields;
}

export function parsePositiveId(value) {
  if (!/^[1-9]\d*$/.test(value)) return null;
  const id = Number(value);
  return Number.isSafeInteger(id) ? id : null;
}
