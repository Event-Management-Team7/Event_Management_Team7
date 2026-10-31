import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import test from 'node:test';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { Database } from '../src/db/database.js';

test('the test run blocks connections to real hosts (no real SMTP or CAPTCHA calls)', async () => {
  assert.throws(() => net.connect(587, 'smtp.example.com'), /Blocked external network connection to smtp\.example\.com/);
  assert.throws(() => net.connect({ port: 443, host: 'challenges.cloudflare.com' }), /Blocked external network connection/);
  await assert.rejects(fetch('https://www.google.com/recaptcha/api/siteverify', { method: 'POST' }));
});

test('connections to this machine are still allowed', async (t) => {
  const server = http.createServer((_req, res) => res.end('ok'));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  const response = await fetch(`http://127.0.0.1:${server.address().port}/`);
  assert.equal(await response.text(), 'ok');
});

test('an app built with default configuration needs no network: in-memory mail and CAPTCHA test mode', async (t) => {
  const db = new Database(':memory:');
  t.after(() => db.close());
  // No mailer, captcha or env settings: registration sends a verification email and checks a CAPTCHA token.
  const app = createApp({ db, passwordCost: 4, jwtSecret: 'x'.repeat(32), appBaseUrl: 'https://emrs.example.test' });
  const response = await request(app).post('/api/auth/register').send({
    name: 'No Network',
    email: 'no-network@example.test',
    password: 'SecurePass123',
    role: 'Attendee',
    captchaToken: 'test-pass'
  });
  assert.equal(response.status, 201, response.text);
  assert.equal(db.get('SELECT COUNT(*) AS count FROM email_verification_tokens').count, 1);
});
