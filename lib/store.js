// One atomic operation: concurrent requests cannot double-count the same IP.
export const RECORD_SCRIPT = `
local counted = 0
if redis.call('SET', KEYS[4], '1', 'EX', 30, 'NX') then
  counted = 1
  redis.call('INCR', KEYS[1])
  redis.call('SADD', KEYS[2], ARGV[1])
  redis.call('LPUSH', KEYS[3], ARGV[2])
  redis.call('LTRIM', KEYS[3], 0, 99)
end
return {tonumber(redis.call('GET', KEYS[1]) or '0'), redis.call('SCARD', KEYS[2]), counted}
`;

export const STATS_SCRIPT = `
return {tonumber(redis.call('GET', KEYS[1]) or '0'), redis.call('SCARD', KEYS[2])}
`;

export const ADMIN_SCRIPT = `
return {tonumber(redis.call('GET', KEYS[1]) or '0'), redis.call('SCARD', KEYS[2]), redis.call('LRANGE', KEYS[3], 0, 99)}
`;

export const ATTEMPT_SCRIPT = `
local attempts = redis.call('INCR', KEYS[1])
if attempts == 1 then redis.call('EXPIRE', KEYS[1], 60) end
return attempts
`;

export class ConfigurationError extends Error {}

export function readConfig(env = process.env) {
  const url = env.UPSTASH_REDIS_REST_URL || env.KV_REST_API_URL;
  const token = env.UPSTASH_REDIS_REST_TOKEN || env.KV_REST_API_TOKEN;
  const password = env.ADMIN_PASSWORD;
  const salt = env.IP_HASH_SALT;
  let validUrl = false;
  try { validUrl = new URL(url).protocol === 'https:'; } catch { /* missing URL */ }
  if (!validUrl || !token || !password || password.length < 24 || !salt || salt.length < 32) {
    throw new ConfigurationError('Faltan variables de entorno o los secretos son demasiado cortos.');
  }
  return { url: url.replace(/\/+$/, ''), token, password, salt, prefix: env.REDIS_KEY_PREFIX || 'pulso:v1' };
}

export class RedisStore {
  constructor(config, fetcher = globalThis.fetch) {
    this.config = config;
    this.fetcher = fetcher;
  }

  async command(args) {
    const response = await this.fetcher(this.config.url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.config.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(args),
      signal: AbortSignal.timeout(6000)
    });
    if (!response.ok) throw new Error('Database request failed');
    const data = await response.json();
    if (data.error || !Object.hasOwn(data, 'result')) throw new Error('Database command failed');
    return data.result;
  }

  keys() {
    const p = this.config.prefix;
    return [`${p}:total`, `${p}:unique`, `${p}:recent`];
  }

  async record(ip, identity, at) {
    const result = await this.command([
      'EVAL', RECORD_SCRIPT, 4, ...this.keys(), `${this.config.prefix}:cooldown:${identity}`,
      identity, JSON.stringify({ ip, at })
    ]);
    return { total: Number(result[0]), unique: Number(result[1]), counted: result[2] === 1 };
  }

  async stats() {
    const result = await this.command(['EVAL', STATS_SCRIPT, 2, ...this.keys().slice(0, 2)]);
    return { total: Number(result[0]), unique: Number(result[1]) };
  }

  async admin() {
    const result = await this.command(['EVAL', ADMIN_SCRIPT, 3, ...this.keys()]);
    return {
      total: Number(result[0]), unique: Number(result[1]),
      visits: result[2].map(value => JSON.parse(value))
    };
  }

  async failedAttempt(identity) {
    return Number(await this.command(['EVAL', ATTEMPT_SCRIPT, 1, `${this.config.prefix}:login:${identity}`]));
  }
}
