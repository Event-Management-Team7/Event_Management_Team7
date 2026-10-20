const EMAIL_PATTERN = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;
const ROLES = new Set(['Attendee', 'Organizer', 'Admin']);
const REGISTRATION_ROLE_ERROR = 'Role must be Attendee, Organizer, or Admin.';

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
  const rawRole = typeof input.role === 'string' ? input.role : '';
  const role = rawRole.trim();

  if (name.length < 2 || name.length > 60 || !/^[A-Za-z .'-]+$/.test(name)) {
    fields.name = 'Name must be 2-60 characters and contain only letters, spaces, or hyphens.';
  }
  if (!email || email.length > 254 || !EMAIL_PATTERN.test(email)) {
    fields.email = 'Please enter a valid email address.';
  }
  if (rawPhone && !/^[6-9]\d{9}$/.test(phone)) {
    fields.phone = 'Phone must be a valid 10-digit number.';
  }
  if (password.length < 8 || password.length > 128 || !/[A-Za-z]/.test(password) || !/\d/.test(password)) {
    fields.password = 'Password must be at least 8 characters long and contain both letters and numbers.';
  }
  if (rawRole && !ROLES.has(role)) fields.role = REGISTRATION_ROLE_ERROR;
  return fields;
}

function isPastDate(dateString) {
  const value = dateString.trim();
  const match = /^(\d+)-(\d+)-(\d+)(?:[T ](\d+):(\d+))?/.exec(value);
  if (!match) return false;

  const [, yearText, monthText, dayText, hourText, minuteText] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const hasTime = hourText !== undefined;
  const date = new Date(year, month - 1, day, hasTime ? Number(hourText) : 23, hasTime ? Number(minuteText) : 59, hasTime ? 0 : 59);
  if (Number.isNaN(date.getTime())) return false;
  return date.getTime() < Date.now();
}

export function validateEvent(input) {
  const fields = {};
  const title = typeof input.title === 'string' ? input.title : '';
  const description = typeof input.description === 'string' ? input.description : '';
  const category = typeof input.category === 'string' ? input.category : '';
  const date = typeof input.date === 'string' ? input.date : '';
  const venue = typeof input.venue === 'string' ? input.venue : '';
  const capacity = typeof input.capacity === 'number' ? input.capacity : 0;
  const price = typeof input.price === 'number' ? input.price : 0;

  if (!title.trim() || title.length > 120) fields.title = 'Title is required (maximum 120 characters).';
  if (!description.trim()) fields.description = 'Description is required.';
  if (!category.trim()) fields.category = 'Category is required.';
  if (!date.trim()) fields.date = 'Date is required.';
  else if (isPastDate(date)) fields.date = 'Event date cannot be in the past.';
  if (!venue.trim()) fields.venue = 'Venue is required.';
  if (!Number.isInteger(capacity) || capacity <= 0) fields.capacity = 'Capacity must be greater than zero.';
  if (!Number.isFinite(price) || price < 0) fields.price = 'Price cannot be negative.';
  return fields;
}

export function parsePositiveId(value) {
  if (!/^[1-9]\d*$/.test(value)) return null;
  const id = Number(value);
  return Number.isSafeInteger(id) ? id : null;
}
