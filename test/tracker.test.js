import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { createVisitsHandler, createAdminHandler } from '../lib/handlers.js';
import { clientIp, normalizeIp, hashIp, passwordMatches } from '../lib/security.js';
import { readConfig, RedisStore, RECORD_SCRIPT } from '../lib/store.js';

const config = {
  url: 'https://database.example', token: randomBytes(32).toString('hex'), prefix: 'test:v1',
  password: randomBytes(32).toString('hex'), salt: randomBytes(32).toString('hex')
};

function request(method = 'GET', headers = {}) {
  return { method, headers: { host: 'example.test', ...headers }, socket: { remoteAddress: '203.0.113.10' } };
}

async function invoke(handler, req) {
  const headers = {};
  let body;
  const res = { statusCode: 200, setHeader: (key, value) => { headers[key] = value; }, end: text => { body = JSON.parse(text); } };
  await handler(req, res);
  return { status: res.statusCode, headers, body };
}

function services(store) { return { config, store, ip: req => clientIp(req, false), mode: 'live' }; }

test('IPs are validated and equivalent IPv6 addresses share an identity', () => {
  assert.equal(normalizeIp('::ffff:192.0.2.1'), '192.0.2.1');
  assert.equal(normalizeIp('2001:0db8:0000:0000:0000:0000:0000:0001'), normalizeIp('2001:db8::1'));
  assert.equal(normalizeIp('2001:DB8::1'), normalizeIp('2001:db8::1'));
  assert.equal(normalizeIp('<script>'), null);
  assert.equal(normalizeIp('999.1.1.1'), null);
  assert.equal(hashIp('192.0.2.1', config.salt).length, 64);
  assert.notEqual(hashIp('192.0.2.1', config.salt), hashIp('192.0.2.1', 'different salt'));
});

test('only a trusted Vercel deployment uses forwarded IP headers', () => {
  const req = request('GET', { 'x-vercel-forwarded-for': '198.51.100.7', 'x-forwarded-for': '198.51.100.99' });
  assert.equal(clientIp(req, false), '203.0.113.10');
  assert.equal(clientIp(req, true), '198.51.100.7');
  assert.equal(clientIp(request('GET', { 'x-forwarded-for': '198.51.100.8, 192.0.2.5' }), true), '198.51.100.8');
  assert.equal(clientIp(request(), true), null);
});

test('public statistics never expose the visitor history or a secret', async () => {
  const handler = createVisitsHandler(services({ stats: async () => ({ total: 9, unique: 3 }) }));
  const result = await invoke(handler, request());
  assert.equal(result.status, 200);
  assert.equal(result.body.total, 9);
  assert.equal(result.body.ip, '203.0.113.10');
  assert.equal(result.body.visits, undefined);
  assert.match(result.headers['Cache-Control'], /no-store/);
  assert.ok(!JSON.stringify(result.body).includes(config.password));
});

test('POST uses the server IP and hash; GET does not register a visit', async () => {
  let calls = 0;
  const handler = createVisitsHandler(services({
    record: async (ip, identity, at) => {
      calls++;
      assert.equal(ip, '203.0.113.10');
      assert.equal(identity, hashIp(ip, config.salt));
      assert.ok(Number.isFinite(Date.parse(at)));
      return { total: 1, unique: 1, counted: true };
    },
    stats: async () => ({ total: 1, unique: 1 })
  }));
  assert.equal((await invoke(handler, request('POST'))).body.counted, true);
  await invoke(handler, request());
  assert.equal(calls, 1);
});

test('cross-origin requests and unsupported methods cannot register visits', async () => {
  const handler = createVisitsHandler(services({ record: () => assert.fail('unexpected write') }));
  assert.equal((await invoke(handler, request('POST', { origin: 'https://other.test' }))).status, 403);
  assert.equal((await invoke(handler, request('POST', { 'sec-fetch-site': 'cross-site' }))).status, 403);
  const result = await invoke(handler, request('DELETE'));
  assert.equal(result.status, 405);
  assert.equal(result.headers.Allow, 'GET, POST');
});

test('private history requires the full correct password', async () => {
  let reads = 0;
  const handler = createAdminHandler(services({
    failedAttempt: async () => 1,
    admin: async () => { reads++; return { total: 1, unique: 1, visits: [{ ip: '192.0.2.3', at: '2026-10-18T12:00:00Z' }] }; }
  }));
  assert.equal((await invoke(handler, request())).status, 401);
  assert.equal((await invoke(handler, request('GET', { authorization: 'Bearer wrong-password' }))).status, 401);
  assert.equal(reads, 0);
  const result = await invoke(handler, request('GET', { authorization: `Bearer ${config.password}` }));
  assert.equal(result.status, 200);
  assert.equal(result.body.visits[0].ip, '192.0.2.3');
  assert.equal(reads, 1);
  assert.equal(passwordMatches(config.password, config.password), true);
  assert.equal(passwordMatches('short', config.password), false);
});

test('repeated incorrect login attempts are limited', async () => {
  const handler = createAdminHandler(services({ failedAttempt: async () => 11 }));
  const result = await invoke(handler, request('GET', { authorization: 'Bearer wrong' }));
  assert.equal(result.status, 429);
  assert.equal(result.headers['Retry-After'], '60');
});

test('database failures return a useful error without leaking provider details', async () => {
  const handler = createVisitsHandler(services({ stats: async () => { throw new Error(`Provider error ${config.token}`); } }));
  const result = await invoke(handler, request());
  assert.equal(result.status, 503);
  assert.ok(!JSON.stringify(result.body).includes(config.token));
});

test('production configuration fails closed without valid secrets and storage', () => {
  assert.throws(() => readConfig({}));
  assert.throws(() => readConfig({ UPSTASH_REDIS_REST_URL: 'http://database.example' }));
  const valid = readConfig({ UPSTASH_REDIS_REST_URL: config.url, UPSTASH_REDIS_REST_TOKEN: config.token, ADMIN_PASSWORD: config.password, IP_HASH_SALT: config.salt });
  assert.equal(valid.password, config.password);
});

test('Redis receives one atomic EVAL with cooldown, private history and hashed identity', async () => {
  const store = new RedisStore(config, async (url, init) => {
    assert.equal(url, config.url);
    assert.equal(init.headers.Authorization, `Bearer ${config.token}`);
    const args = JSON.parse(init.body);
    assert.equal(args[0], 'EVAL');
    assert.equal(args[1], RECORD_SCRIPT);
    assert.equal(args[2], 4);
    assert.equal(args[6], 'test:v1:cooldown:private-hash');
    assert.equal(args[7], 'private-hash');
    assert.deepEqual(JSON.parse(args[8]), { ip: '192.0.2.1', at: '2026-10-18T12:00:00Z' });
    return Response.json({ result: [8, 4, 0] });
  });
  assert.deepEqual(await store.record('192.0.2.1', 'private-hash', '2026-10-18T12:00:00Z'), { total: 8, unique: 4, counted: false });
});

test('Redis errors are never mistaken for a saved visit', async () => {
  const store = new RedisStore(config, async () => Response.json({ error: 'ERR' }));
  await assert.rejects(store.record('192.0.2.1', 'hash', new Date().toISOString()));
});
