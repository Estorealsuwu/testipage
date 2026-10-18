import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createAdminHandler, createVisitsHandler } from '../lib/handlers.js';
import { clientIp } from '../lib/security.js';
import { readConfig, RedisStore } from '../lib/store.js';
import { MemoryStore } from './memory-store.mjs';

const root = new URL('../public/', import.meta.url);
const manifest = JSON.parse(await readFile(new URL('../vercel.json', import.meta.url), 'utf8'));
const configured = ['UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN', 'KV_REST_API_URL', 'KV_REST_API_TOKEN', 'ADMIN_PASSWORD', 'IP_HASH_SALT'].some(key => process.env[key]);
const config = configured ? readConfig() : {
  password: randomBytes(24).toString('hex'),
  salt: randomBytes(32).toString('hex')
};
const services = {
  config,
  store: configured ? new RedisStore(config) : new MemoryStore(),
  ip: req => clientIp(req, false),
  mode: configured ? 'live' : 'demo'
};
const visits = createVisitsHandler(services);
const admin = createAdminHandler(services);
const files = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/index.html', ['index.html', 'text/html; charset=utf-8']],
  ['/styles.css', ['styles.css', 'text/css; charset=utf-8']],
  ['/app.js', ['app.js', 'text/javascript; charset=utf-8']],
  ['/admin.js', ['admin.js', 'text/javascript; charset=utf-8']],
  ['/meme.png', ['meme.png', 'image/png']]
]);

const server = createServer(async (req, res) => {
  for (const header of manifest.headers[0].headers) res.setHeader(header.key, header.value);
  res.setHeader('Cache-Control', 'no-store');
  try {
    const pathname = new URL(req.url, 'http://localhost').pathname;
    if (pathname === '/api/visits') return await visits(req, res);
    if (pathname === '/api/admin') return await admin(req, res);
    const file = files.get(pathname);
    if (!file || !['GET', 'HEAD'].includes(req.method)) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('Página no encontrada');
    }
    res.setHeader('Content-Type', file[1]);
    const content = await readFile(fileURLToPath(new URL(file[0], root)));
    res.end(req.method === 'HEAD' ? undefined : content);
  } catch {
    res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('No pudimos procesar la solicitud.');
  }
});

const port = Number(process.env.PORT || 8787);
server.listen(port, '127.0.0.1', () => {
  console.log(`Pulso: http://127.0.0.1:${port}`);
  console.log(configured ? 'Almacenamiento: Redis configurado en .env.local' : 'Modo local: memoria temporal.');
  if (!configured) console.log(`Contraseña temporal del panel local: ${config.password}`);
});

for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close(() => process.exit(0)));
