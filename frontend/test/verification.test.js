import assert from 'node:assert/strict';
import test from 'node:test';
import { parseVerificationToken } from '../src/verification.js';

const TOKEN = 'A'.repeat(43);

test('finds the token in a verification link fragment', () => {
  assert.equal(parseVerificationToken(`#verify-email=${TOKEN}`), TOKEN);
  const real = 'aB3-_xYz9aB3-_xYz9aB3-_xYz9aB3-_xYz9aB3-_xY';
  assert.equal(real.length, 43);
  assert.equal(parseVerificationToken(`#verify-email=${real}`), real);
});

test('ignores other fragments and malformed tokens', () => {
  for (const hash of ['', '#', '#events', '#verify-email=', '#verify-email=short', `#verify-email=${'A'.repeat(44)}`,
    `#verify-email=${TOKEN}&x=1`, `#verify-email=${'A'.repeat(42)}!`, `verify-email=${TOKEN}`, null, undefined, 42]) {
    assert.equal(parseVerificationToken(hash), null, String(hash));
  }
});
