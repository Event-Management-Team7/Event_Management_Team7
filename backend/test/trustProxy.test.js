import assert from 'node:assert/strict';
import test from 'node:test';
import { parseTrustProxy } from '../src/util/trustProxy.js';

test('trust proxy stays off unless configured', () => {
  for (const value of [undefined, null, false, '', '  ', 'false', 'FALSE']) assert.equal(parseTrustProxy(value), false);
});

test('a hop count or address list is passed through', () => {
  assert.equal(parseTrustProxy('1'), 1);
  assert.equal(parseTrustProxy(2), 2);
  assert.equal(parseTrustProxy('loopback'), 'loopback');
  assert.equal(parseTrustProxy('10.0.0.0/8, 172.16.0.1'), '10.0.0.0/8, 172.16.0.1');
});

test('"true" is refused because it would let clients forge their IP and bypass rate limits', () => {
  assert.throws(() => parseTrustProxy('true'), /bypass rate limits/);
  assert.throws(() => parseTrustProxy(true), /bypass rate limits/);
});
