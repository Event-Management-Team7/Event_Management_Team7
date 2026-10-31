import assert from 'node:assert/strict';
import test from 'node:test';
import { FailureTracker } from '../src/services/failureTracker.js';

test('counts failures per key and clears them', () => {
  const tracker = new FailureTracker({ clock: () => 100 });
  assert.equal(tracker.count('email:a'), 0);
  tracker.record('email:a');
  tracker.record('email:a');
  tracker.record('ip:1');
  assert.equal(tracker.count('email:a'), 2);
  assert.equal(tracker.count('ip:1'), 1);
  tracker.clear('email:a');
  assert.equal(tracker.count('email:a'), 0);
  assert.equal(tracker.count('ip:1'), 1);
});

test('failures expire after the window and each new failure extends it', () => {
  const time = { now: 0 };
  const tracker = new FailureTracker({ clock: () => time.now, windowSeconds: 60 });
  tracker.record('k');
  time.now = 50;
  tracker.record('k');
  time.now = 100;
  assert.equal(tracker.count('k'), 2, 'the second failure moved the expiry to 110');
  time.now = 110;
  assert.equal(tracker.count('k'), 0);
  assert.equal(tracker.record('k'), 1, 'counting starts again after expiry');
});

test('memory is bounded: expired entries go first, then the least recently updated', () => {
  const time = { now: 0 };
  const tracker = new FailureTracker({ clock: () => time.now, windowSeconds: 10, maxEntries: 3 });
  tracker.record('old-1');
  tracker.record('old-2');
  time.now = 20;
  tracker.record('new-1');
  tracker.record('new-2');
  assert.equal(tracker.entries.size, 2, 'expired entries were dropped');
  tracker.record('new-3');
  tracker.record('new-4');
  assert.equal(tracker.entries.size, 3);
  assert.equal(tracker.count('new-1'), 0, 'the oldest live entry was evicted');
  assert.equal(tracker.count('new-4'), 1);
});
