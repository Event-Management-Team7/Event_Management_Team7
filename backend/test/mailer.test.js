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

test('smtp transport passes configuration and messages to the injected Nodemailer transport', async () => {
  const env = {
    SMTP_HOST: 'smtp.example.test',
    SMTP_PORT: '587',
    SMTP_USER: 'mailer@example.test',
    SMTP_PASS: 'smtp-secret',
    MAIL_FROM: 'EMRS <noreply@example.test>'
  };
  let transportConfig;
  const sent = [];
  const mailer = createMailer({
    transport: 'smtp',
    env,
    smtpTransportFactory(config) {
      transportConfig = config;
      return {
        async sendMail(message) {
          sent.push(message);
          return { messageId: 'stubbed-message-id' };
        }
      };
    }
  });

  assert.deepEqual(transportConfig, {
    host: 'smtp.example.test',
    port: 587,
    secure: false,
    auth: { user: 'mailer@example.test', pass: 'smtp-secret' }
  });
  const result = await mailer.sendMail({
    to: 'alice@example.test',
    subject: 'Welcome',
    text: 'Verify your email.'
  });
  assert.deepEqual(sent, [{
    from: 'EMRS <noreply@example.test>',
    to: 'alice@example.test',
    subject: 'Welcome',
    text: 'Verify your email.'
  }]);
  assert.deepEqual(result, { messageId: 'stubbed-message-id' });
});

test('smtp configuration rejects missing settings and invalid ports', () => {
  assert.throws(
    () => createMailer({ transport: 'smtp', env: {} }),
    /SMTP_HOST is required/
  );
  assert.throws(
    () => createMailer({
      transport: 'smtp',
      env: {
        SMTP_HOST: 'smtp.example.test',
        SMTP_PORT: 'not-a-port',
        SMTP_USER: 'mailer',
        SMTP_PASS: 'secret',
        MAIL_FROM: 'noreply@example.test'
      }
    }),
    /SMTP_PORT must be an integer/
  );
});

test('smtp failures are isolated and do not log the password, token, or message body', async () => {
  const smtpPassword = 'smtp-secret-value';
  const verificationToken = 'verification-token-value';
  const privateBody = `Verify with ${verificationToken}.`;
  const originalError = console.error;
  const logs = [];

  console.error = (...args) => logs.push(args);

  try {
    const mailer = createMailer({
      transport: 'smtp',
      env: {
        SMTP_HOST: 'smtp.example.test',
        SMTP_PORT: '465',
        SMTP_USER: 'mailer@example.test',
        SMTP_PASS: smtpPassword,
        MAIL_FROM: 'noreply@example.test'
      },
      smtpTransportFactory() {
        return {
          async sendMail() {
            throw new Error(`Failed with ${smtpPassword}: ${verificationToken}: ${privateBody}`);
          }
        };
      }
    });

    const result = await mailer.sendMail({
      to: 'alice@example.test',
      subject: 'Verify your email',
      text: privateBody
    });

    assert.equal(result, null);
    assert.deepEqual(logs, [['Email delivery failed']]);
    const logText = JSON.stringify(logs);
    assert.doesNotMatch(logText, /smtp-secret-value|verification-token-value|Verify with/);
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
