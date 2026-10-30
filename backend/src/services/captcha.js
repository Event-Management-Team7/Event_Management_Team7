// Server-side CAPTCHA verification (EMT-29, EMRS-SEC-004).
//
// Configuration (environment variables):
//   CAPTCHA_PROVIDER   turnstile | recaptcha | test
//   CAPTCHA_SECRET     the provider's secret key (server side only, never sent to the browser)
//   CAPTCHA_SITE_KEY   the provider's public site key (returned by GET /api/auth/captcha-config)
//
// `test` is an offline mode for automated tests and local development: it needs no keys and accepts any
// token except the literal "test-fail". It is refused when NODE_ENV=production.
// To exercise a real provider without a real challenge, use the provider's published test keys
// (see README): they make the provider always pass or always fail.
//
// When nothing is configured, development and tests use `test` mode. In production the verifier
// fails closed: registration is blocked with 503 until CAPTCHA is configured, but the server still starts.

const PROVIDERS = {
  turnstile: 'https://challenges.cloudflare.com/turnstile/v0/siteverify',
  recaptcha: 'https://www.google.com/recaptcha/api/siteverify'
};

export const TEST_MODE_FAIL_TOKEN = 'test-fail';
export const MAX_CAPTCHA_TOKEN_LENGTH = 4096;

const warned = new Set();
function warnOnce(message) {
  if (warned.has(message)) return;
  warned.add(message);
  console.warn(message);
}

function unconfigured() {
  return {
    provider: null,
    siteKey: null,
    configured: false,
    async verify() {
      return { ok: false, unavailable: true };
    }
  };
}

function createTestVerifier() {
  return {
    provider: 'test',
    siteKey: 'test-site-key',
    configured: true,
    async verify(token) {
      return { ok: token !== TEST_MODE_FAIL_TOKEN };
    }
  };
}

function createProviderVerifier({ provider, secret, siteKey, fetchFn, timeoutMs }) {
  const url = PROVIDERS[provider];
  return {
    provider,
    siteKey,
    configured: true,
    async verify(token, remoteIp) {
      const body = new URLSearchParams({ secret, response: token });
      if (remoteIp) body.set('remoteip', remoteIp);
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await fetchFn(url, { method: 'POST', body, signal: controller.signal });
        if (!response.ok) return { ok: false, unavailable: true };
        const result = await response.json();
        return result?.success === true ? { ok: true } : { ok: false };
      } catch {
        // Network errors, timeouts and unreadable responses: the check could not be made, so do not let the request through.
        return { ok: false, unavailable: true };
      } finally {
        clearTimeout(timer);
      }
    }
  };
}

export function createCaptchaVerifier({
  provider = process.env.CAPTCHA_PROVIDER,
  secret = process.env.CAPTCHA_SECRET,
  siteKey = process.env.CAPTCHA_SITE_KEY,
  nodeEnv = process.env.NODE_ENV,
  fetchFn = globalThis.fetch,
  timeoutMs = 5000
} = {}) {
  const production = nodeEnv === 'production';
  let name = typeof provider === 'string' ? provider.trim().toLowerCase() : '';

  if (!name) {
    if (production) {
      warnOnce('CAPTCHA_PROVIDER is not set: registration is blocked until CAPTCHA is configured.');
      return unconfigured();
    }
    warnOnce('CAPTCHA_PROVIDER is not set: using offline CAPTCHA test mode (development only).');
    name = 'test';
  }

  if (name === 'test') {
    if (production) {
      warnOnce('CAPTCHA_PROVIDER=test is not allowed when NODE_ENV=production: registration is blocked.');
      return unconfigured();
    }
    return createTestVerifier();
  }

  if (!PROVIDERS[name]) {
    warnOnce(`Unsupported CAPTCHA_PROVIDER "${name}": use turnstile, recaptcha or test.`);
    return unconfigured();
  }
  if (!secret || !siteKey) {
    warnOnce(`CAPTCHA_PROVIDER=${name} needs CAPTCHA_SECRET and CAPTCHA_SITE_KEY: registration is blocked.`);
    return unconfigured();
  }
  return createProviderVerifier({ provider: name, secret, siteKey, fetchFn, timeoutMs });
}
