import assert from 'node:assert/strict';
import test from 'node:test';
import { createCaptchaVerifier } from '../src/services/captcha.js';

function silenceWarnings(t) {
  const original = console.warn;
  const warnings = [];
  console.warn = (...args) => warnings.push(args.join(' '));
  t.after(() => { console.warn = original; });
  return warnings;
}

function fakeFetch(handler) {
  const calls = [];
  const fetchFn = async (url, init) => {
    calls.push({ url, init, body: Object.fromEntries(init.body) });
    return handler(url, init);
  };
  fetchFn.calls = calls;
  return fetchFn;
}

const json = (value, status = 200) => ({ ok: status < 400, status, json: async () => value });

for (const [provider, url] of [
  ['turnstile', 'https://challenges.cloudflare.com/turnstile/v0/siteverify'],
  ['recaptcha', 'https://www.google.com/recaptcha/api/siteverify']
]) {
  test(`${provider}: posts the secret, token and client IP and accepts success`, async () => {
    const fetchFn = fakeFetch(() => json({ success: true }));
    const verifier = createCaptchaVerifier({ provider, secret: 'secret-key', siteKey: 'site-key', fetchFn });
    assert.equal(verifier.provider, provider);
    assert.equal(verifier.siteKey, 'site-key');
    assert.deepEqual(await verifier.verify('user-token', '203.0.113.9'), { ok: true });
    assert.equal(fetchFn.calls[0].url, url);
    assert.equal(fetchFn.calls[0].init.method, 'POST');
    assert.deepEqual(fetchFn.calls[0].body, { secret: 'secret-key', response: 'user-token', remoteip: '203.0.113.9' });
  });

  test(`${provider}: a rejected token is a failed check, not an outage`, async () => {
    const verifier = createCaptchaVerifier({
      provider, secret: 's', siteKey: 'k', fetchFn: fakeFetch(() => json({ success: false, 'error-codes': ['invalid-input-response'] }))
    });
    assert.deepEqual(await verifier.verify('bad'), { ok: false });
  });

  test(`${provider}: HTTP errors, network errors and unreadable replies fail closed as unavailable`, async () => {
    const make = (handler) => createCaptchaVerifier({ provider, secret: 's', siteKey: 'k', fetchFn: fakeFetch(handler) });
    assert.deepEqual(await make(() => json({}, 500)).verify('t'), { ok: false, unavailable: true });
    assert.deepEqual(await make(() => { throw new Error('offline'); }).verify('t'), { ok: false, unavailable: true });
    assert.deepEqual(
      await make(() => ({ ok: true, json: async () => { throw new SyntaxError('not json'); } })).verify('t'),
      { ok: false, unavailable: true }
    );
    assert.deepEqual(await make(() => json({ success: 'yes' })).verify('t'), { ok: false });
  });
}

test('a provider that never answers times out as unavailable', async () => {
  const fetchFn = (_url, { signal }) => new Promise((_resolve, reject) => {
    signal.addEventListener('abort', () => reject(new Error('aborted')));
  });
  const verifier = createCaptchaVerifier({ provider: 'turnstile', secret: 's', siteKey: 'k', fetchFn, timeoutMs: 20 });
  assert.deepEqual(await verifier.verify('t'), { ok: false, unavailable: true });
});

test('the remote IP is optional', async () => {
  const fetchFn = fakeFetch(() => json({ success: true }));
  await createCaptchaVerifier({ provider: 'turnstile', secret: 's', siteKey: 'k', fetchFn }).verify('t');
  assert.equal('remoteip' in fetchFn.calls[0].body, false);
});

test('test mode needs no keys and accepts any token except "test-fail"', async (t) => {
  silenceWarnings(t);
  const verifier = createCaptchaVerifier({ provider: 'test', nodeEnv: 'development' });
  assert.equal(verifier.provider, 'test');
  assert.deepEqual(await verifier.verify('anything'), { ok: true });
  assert.deepEqual(await verifier.verify('test-fail'), { ok: false });
});

test('with nothing configured, development uses test mode', async (t) => {
  silenceWarnings(t);
  const verifier = createCaptchaVerifier({ provider: undefined, nodeEnv: undefined });
  assert.equal(verifier.provider, 'test');
  assert.equal(verifier.configured, true);
});

test('in production, a missing provider or test mode fails closed instead of letting requests through', async (t) => {
  const warnings = silenceWarnings(t);
  for (const provider of [undefined, '', 'test']) {
    const verifier = createCaptchaVerifier({ provider, nodeEnv: 'production' });
    assert.equal(verifier.configured, false);
    assert.equal(verifier.provider, null);
    assert.deepEqual(await verifier.verify('test-pass'), { ok: false, unavailable: true });
  }
  assert.ok(warnings.length >= 1);
});

test('incomplete or unknown configuration is treated as not configured', async (t) => {
  silenceWarnings(t);
  for (const options of [
    { provider: 'turnstile', siteKey: 'k' },
    { provider: 'turnstile', secret: 's' },
    { provider: 'hcaptcha', secret: 's', siteKey: 'k' }
  ]) {
    const verifier = createCaptchaVerifier({ ...options, fetchFn: () => { throw new Error('must not be called'); } });
    assert.equal(verifier.configured, false);
    assert.deepEqual(await verifier.verify('t'), { ok: false, unavailable: true });
  }
});

test('provider names are case-insensitive and the secret is never exposed on the verifier', () => {
  const verifier = createCaptchaVerifier({ provider: ' Turnstile ', secret: 'very-secret', siteKey: 'k' });
  assert.equal(verifier.provider, 'turnstile');
  assert.equal(JSON.stringify(verifier).includes('very-secret'), false);
});
