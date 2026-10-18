// Only used by the local preview server. Never imported by Vercel functions.
export class MemoryStore {
  total = 0;
  unique = new Set();
  visits = [];
  cooldowns = new Map();
  attempts = new Map();

  async record(ip, identity, at) {
    const now = Date.now();
    for (const [key, expires] of this.cooldowns) if (expires <= now) this.cooldowns.delete(key);
    const counted = !this.cooldowns.has(identity);
    if (counted) {
      this.cooldowns.set(identity, now + 30_000);
      this.total++;
      this.unique.add(identity);
      this.visits.unshift({ ip, at });
      this.visits = this.visits.slice(0, 100);
    }
    return { ...await this.stats(), counted };
  }

  async stats() { return { total: this.total, unique: this.unique.size }; }
  async admin() { return { ...await this.stats(), visits: this.visits }; }

  async failedAttempt(identity) {
    const now = Date.now();
    for (const [key, value] of this.attempts) if (value.until <= now) this.attempts.delete(key);
    const value = this.attempts.get(identity) || { count: 0, until: now + 60_000 };
    value.count++;
    this.attempts.set(identity, value);
    return value.count;
  }
}
