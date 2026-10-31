import { useEffect, useRef, useState } from 'react';
import { api } from '../api.js';

// The server decides which provider to use (GET /api/auth/captcha-config): Cloudflare Turnstile, Google
// reCAPTCHA v2, or an offline "test" checkbox for development. onToken receives the token once the
// challenge is solved and '' whenever it is lost (expired, error, reset).
const SCRIPT_URLS = {
  turnstile: 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit',
  recaptcha: 'https://www.google.com/recaptcha/api.js?render=explicit'
};
const scriptLoads = new Map();

function loadScript(url) {
  if (!scriptLoads.has(url)) {
    scriptLoads.set(url, new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = url;
      script.async = true;
      script.onload = resolve;
      script.onerror = () => {
        scriptLoads.delete(url);
        script.remove();
        reject(new Error('The security check could not be loaded.'));
      };
      document.head.appendChild(script);
    }));
  }
  return scriptLoads.get(url);
}

async function loadWidgetApi(provider) {
  await loadScript(SCRIPT_URLS[provider]);
  if (provider === 'recaptcha') await new Promise((resolve) => window.grecaptcha.ready(resolve));
  return provider === 'turnstile' ? window.turnstile : window.grecaptcha;
}

export default function Captcha({ onToken, resetSignal = 0 }) {
  const [config, setConfig] = useState(null);
  const [problem, setProblem] = useState('');
  const [testChecked, setTestChecked] = useState(false);
  const box = useRef(null);
  const widget = useRef({ widgetApi: null, id: null });
  const onTokenRef = useRef(onToken);
  const firstReset = useRef(true);

  useEffect(() => { onTokenRef.current = onToken; }, [onToken]);

  useEffect(() => {
    let active = true;
    api('/api/auth/captcha-config', { token: null })
      .then((result) => { if (active) setConfig(result); })
      .catch(() => { if (active) setProblem('Could not load the security check. Please refresh the page and try again.'); });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!config || !SCRIPT_URLS[config.provider]) return undefined;
    let active = true;
    loadWidgetApi(config.provider)
      .then((widgetApi) => {
        if (!active || !box.current) return;
        const id = widgetApi.render(box.current, {
          sitekey: config.siteKey,
          callback: (token) => onTokenRef.current(token),
          'expired-callback': () => onTokenRef.current(''),
          'error-callback': () => onTokenRef.current('')
        });
        widget.current = { widgetApi, id };
      })
      .catch(() => { if (active) setProblem('Could not load the security check. Check your connection and try again.'); });
    return () => {
      active = false;
      const { widgetApi, id } = widget.current;
      if (widgetApi && id !== null && id !== undefined) {
        try {
          (widgetApi.remove ?? widgetApi.reset).call(widgetApi, id);
        } catch {
          // The widget was already gone.
        }
      }
      widget.current = { widgetApi: null, id: null };
      onTokenRef.current('');
    };
  }, [config]);

  // Tokens are single use, so the parent bumps resetSignal after every submit.
  useEffect(() => {
    if (firstReset.current) {
      firstReset.current = false;
      return;
    }
    const { widgetApi, id } = widget.current;
    if (widgetApi && id !== null && id !== undefined) {
      try {
        widgetApi.reset(id);
      } catch {
        // Nothing to reset yet.
      }
    }
    setTestChecked(false);
    onTokenRef.current('');
  }, [resetSignal]);

  if (config?.provider === 'test') {
    return (
      <div className="captcha">
        <label className="captcha-test">
          <input
            type="checkbox"
            checked={testChecked}
            onChange={(event) => {
              setTestChecked(event.target.checked);
              onTokenRef.current(event.target.checked ? 'test-pass' : '');
            }}
          />
          <span>I am not a robot <small>(test mode)</small></span>
        </label>
      </div>
    );
  }

  const unavailable = config && !SCRIPT_URLS[config.provider];
  return (
    <div className="captcha" role="group" aria-label="Security check">
      {!config && !problem && <p className="hint" role="status">Loading the security check…</p>}
      {problem && <p className="field-error" role="alert">{problem}</p>}
      {unavailable && <p className="field-error" role="alert">The security check is not available right now. Please try again later.</p>}
      <div ref={box} />
    </div>
  );
}
