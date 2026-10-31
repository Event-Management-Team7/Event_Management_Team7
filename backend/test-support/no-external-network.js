// Loaded with `node --import` by `npm test` (EMT-33). Tests must use the in-memory mail transport and the
// CAPTCHA test mode, so any attempt to reach a non-local host (a real SMTP server, Turnstile, reCAPTCHA...)
// is an error instead of a silent call. Connections to this machine (supertest, local servers) still work.
import net from 'node:net';

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '0.0.0.0', '::']);
const originalConnect = net.Socket.prototype.connect;

function targetHost(args) {
  const first = Array.isArray(args[0]) ? args[0][0] : args[0];
  if (first && typeof first === 'object') return first.path ? null : (first.host ?? 'localhost');
  // net.connect(path) for a Unix socket: a string that is not a port number.
  if (typeof first === 'string' && Number.isNaN(Number(first))) return null;
  return typeof args[1] === 'string' ? args[1] : 'localhost';
}

net.Socket.prototype.connect = function guardedConnect(...args) {
  const host = targetHost(args);
  if (host !== null && !LOCAL_HOSTS.has(host) && !host.startsWith('127.')) {
    throw new Error(`Blocked external network connection to ${host} (tests must not call real services)`);
  }
  return originalConnect.apply(this, args);
};
