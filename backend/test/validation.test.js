import assert from 'node:assert/strict';
import test from 'node:test';
import {
  isValidName,
  isValidEmail,
  isValidPhone,
  isValidPassword,
  isValidRole,
  isObjectBody,
  validateRegistration,
  validateEvent,
  parsePositiveId
} from '../src/util/validation.js';

test('Validation: validates names correctly', () => {
  assert.equal(isValidName('Aariz'), true);
  assert.equal(isValidName('Dhanraj Rathod'), true);
  assert.equal(isValidName('Vaishali Krishnan'), true);
  assert.equal(isValidName('Avinash Julakatti'), true);
  assert.equal(isValidName('  Padded Name  '), true);
  assert.equal(isValidName(''), false);
  assert.equal(isValidName('A'), false);
  assert.equal(isValidName('x'.repeat(51)), false);
  assert.equal(isValidName(null), false);
  assert.equal(isValidName(123), false);
});

test('Validation: validates emails correctly', () => {
  assert.equal(isValidEmail('test@example.com'), true);
  assert.equal(isValidEmail('user.name+tag@sub.domain.org'), true);
  assert.equal(isValidEmail('  user@example.com  '), true);
  assert.equal(isValidEmail('invalid-email'), false);
  assert.equal(isValidEmail('@nodomain.com'), false);
  assert.equal(isValidEmail('user@.com'), false);
  assert.equal(isValidEmail(''), false);
  assert.equal(isValidEmail(null), false);
});

test('Validation: validates passwords correctly', () => {
  assert.equal(isValidPassword('SecurePass123'), true);
  assert.equal(isValidPassword('P@ssword1'), true);
  assert.equal(isValidPassword('short1A'), false); // < 8 chars
  assert.equal(isValidPassword('alllowercase123'), false); // missing uppercase
  assert.equal(isValidPassword('ALLUPPERCASE123'), false); // missing lowercase
  assert.equal(isValidPassword('NoDigitsHere!'), false); // missing digit
  assert.equal(isValidPassword(`Aa1${'x'.repeat(70)}`), false); // > 72 bytes
  assert.equal(isValidPassword(null), false);
});

test('Validation: validates phone numbers correctly', () => {
  assert.equal(isValidPhone('9876543210'), true);
  assert.equal(isValidPhone('8123456789'), true);
  assert.equal(isValidPhone('6999988888'), true);
  assert.equal(isValidPhone('5123456789'), false); // doesn't start with 6-9
  assert.equal(isValidPhone('987654321'), false); // 9 digits
  assert.equal(isValidPhone('98765432100'), false); // 11 digits
  assert.equal(isValidPhone('abcdefghij'), false);
  assert.equal(isValidPhone(null), false);
});

test('Validation: validates roles strictly for registration', () => {
  assert.equal(isValidRole('Attendee'), true);
  assert.equal(isValidRole('Organizer'), true);
  assert.equal(isValidRole('Admin'), false); // Admin provisioned only, not self-registered
  assert.equal(isValidRole('SuperAdmin'), false);
  assert.equal(isValidRole('Guest'), false);
  assert.equal(isValidRole(''), false);
  assert.equal(isValidRole(null), false);
});

test('Validation: validates registration input structure and required fields', () => {
  const valid = {
    name: 'Aariz',
    email: 'aariz@example.com',
    phone: '9876543210',
    password: 'SecurePassword123',
    role: 'Organizer'
  };
  assert.deepEqual(validateRegistration(valid), {});

  const invalid = {
    name: '',
    email: 'bad-email',
    phone: '123',
    password: 'weak',
    role: 'InvalidRole'
  };
  const errs = validateRegistration(invalid);
  assert.ok(errs.name);
  assert.ok(errs.email);
  assert.ok(errs.phone);
  assert.ok(errs.password);
  assert.ok(errs.role);
});

test('Validation: validates event inputs and rejects invalid/past dates', () => {
  const futureStart = new Date(Date.now() + 86400000).toISOString().slice(0, 16);
  const futureEnd = new Date(Date.now() + 90000000).toISOString().slice(0, 16);

  const validEvent = {
    title: 'Future Tech Expo',
    description: 'A grand exhibition of bleeding edge technologies',
    category: 'Conference',
    startDateTime: futureStart,
    endDateTime: futureEnd,
    venueType: 'Physical',
    venue: 'Expo Center Hall 1',
    capacity: 200,
    ticketTypes: [{ name: 'General Admission', price: 49.99, quantity: 200 }]
  };
  assert.deepEqual(validateEvent(validEvent), {});

  // Past start date
  const pastEvent = {
    ...validEvent,
    startDateTime: '2020-01-01T10:00',
    endDateTime: '2020-01-01T12:00'
  };
  const pastErrs = validateEvent(pastEvent);
  assert.match(pastErrs.startDateTime, /future/i);

  // End date before start date
  const invertedDates = {
    ...validEvent,
    startDateTime: futureEnd,
    endDateTime: futureStart
  };
  const invertErrs = validateEvent(invertedDates);
  assert.match(invertErrs.endDateTime, /after/i);

  // Missing required fields
  const emptyEvent = {};
  const emptyErrs = validateEvent(emptyEvent);
  assert.ok(emptyErrs.title);
  assert.ok(emptyErrs.description);
  assert.ok(emptyErrs.category);
  assert.ok(emptyErrs.startDateTime);
  assert.ok(emptyErrs.endDateTime);
  assert.ok(emptyErrs.venueType);
  assert.ok(emptyErrs.capacity);
  assert.ok(emptyErrs.ticketTypes);

  // Virtual venue requires HTTPS meeting link
  const virtualEvent = {
    ...validEvent,
    venueType: 'Virtual',
    venue: '',
    meetingLink: 'http://insecure.link' // not https
  };
  const virtualErrs = validateEvent(virtualEvent);
  assert.ok(virtualErrs.meetingLink);

  const validVirtual = {
    ...validEvent,
    venueType: 'Virtual',
    venue: '',
    meetingLink: 'https://meet.example.com/xyz-123'
  };
  assert.deepEqual(validateEvent(validVirtual), {});
});

test('Validation: parsePositiveId parses and validates IDs', () => {
  assert.equal(parsePositiveId('1'), 1);
  assert.equal(parsePositiveId('42'), 42);
  assert.equal(parsePositiveId('1000000'), 1000000);
  assert.equal(parsePositiveId('0'), null);
  assert.equal(parsePositiveId('-5'), null);
  assert.equal(parsePositiveId('abc'), null);
  assert.equal(parsePositiveId('1.5'), null);
  assert.equal(parsePositiveId(null), null);
  assert.equal(parsePositiveId(undefined), null);
});

test('Validation: isObjectBody identifies plain non-array objects', () => {
  assert.equal(isObjectBody({}), true);
  assert.equal(isObjectBody({ a: 1 }), true);
  assert.equal(isObjectBody(null), false);
  assert.equal(isObjectBody([]), false);
  assert.equal(isObjectBody('string'), false);
  assert.equal(isObjectBody(123), false);
  assert.equal(isObjectBody(undefined), false);
});
