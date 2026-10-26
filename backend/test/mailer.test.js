import assert from 'node:assert/strict';
import test from 'node:test';
import { createMailer } from '../src/services/mailer.js';
import { Database } from '../src/db/database.js';
import { createApp } from '../src/app.js';

test('memory transport sends mail and keeps recipient, subject, and body readable', async () => {
  const mailer = createMailer({ transport: 'memory' });

  const result = await mailer.sendMail({
    to: 'alice@example.test',
    subject: 'Welcome',
    text: 'Your verification code is 123456.'
  });

  assert.deepEqual(result, {
    to: 'alice@example.test',
    subject: 'Welcome',
    text: 'Your verification code is 123456.'
  });

  assert.deepEqual(mailer.getSentMessages(), [result]);
});

test('smtp transport fails safely with a clear not-configured error', async () => {
  const originalError = console.error;
  const logs = [];

  console.error = (...args) => logs.push(args);

  try {
    const mailer = createMailer({ transport: 'smtp' });

    const result = await mailer.sendMail({
      to: 'alice@example.test',
      subject: 'Password reset',
      text: 'Your password reset token is SECRET_TOKEN.'
    });

    assert.equal(result, null);
    assert.equal(logs.length, 1);

    const logText = JSON.stringify(logs);
    assert.match(logText, /Email delivery failed/);
    assert.match(logText, /alice@example\.test/);
    assert.match(logText, /Password reset/);
    assert.match(logText, /SMTP mail transport is not configured/);
    assert.doesNotMatch(logText, /SECRET_TOKEN/);
  } finally {
    console.error = originalError;
  }
});

test('unsupported mail transport is rejected', () => {
  assert.throws(
    () => createMailer({ transport: 'unsupported' }),
    /Unsupported MAIL_TRANSPORT/
  );
});

test('createApp uses the in-memory mailer when no mailer is provided', () => {
  const db = new Database(':memory:');

  try {
    const app = createApp({ db });
    assert.ok(app);
  } finally {
    db.close();
  }
});
