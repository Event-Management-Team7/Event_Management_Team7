// Counts recent failures per key (an email or an IP) so the login route can require a CAPTCHA
// after repeated failures. Entries expire `windowSeconds` after the most recent failure.
// In memory only, like the per-account lockout in AuthService; a restart resets the counters.
export class FailureTracker {
  constructor({ clock = () => Math.floor(Date.now() / 1000), windowSeconds = 15 * 60, maxEntries = 10_000 } = {}) {
    this.clock = clock;
    this.windowSeconds = windowSeconds;
    this.maxEntries = maxEntries;
    this.entries = new Map();
  }

  count(key) {
    const entry = this.entries.get(key);
    if (!entry) return 0;
    if (entry.expiresAt <= this.clock()) {
      this.entries.delete(key);
      return 0;
    }
    return entry.count;
  }

  record(key) {
    const now = this.clock();
    const current = this.entries.get(key);
    const count = current && current.expiresAt > now ? current.count + 1 : 1;
    // Re-insert so the Map stays ordered from least to most recently updated.
    this.entries.delete(key);
    this.entries.set(key, { count, expiresAt: now + this.windowSeconds });
    this.prune(now);
    return count;
  }

  clear(key) {
    this.entries.delete(key);
  }

  prune(now) {
    if (this.entries.size <= this.maxEntries) return;
    for (const [key, entry] of this.entries) {
      if (entry.expiresAt <= now) this.entries.delete(key);
    }
    for (const key of this.entries.keys()) {
      if (this.entries.size <= this.maxEntries) break;
      this.entries.delete(key);
    }
  }
}
