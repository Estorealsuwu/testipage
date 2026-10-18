import { clientIp, hashIp, passwordMatches, sameOrigin } from './security.js';
import { ConfigurationError, readConfig, RedisStore } from './store.js';

function json(res, status, body) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'private, no-store, max-age=0');
  res.setHeader('CDN-Cache-Control', 'no-store');
  res.setHeader('Vercel-CDN-Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.statusCode = status;
  res.end(JSON.stringify(body));
}

function failure(res, error) {
  // Never return provider responses, tokens, passwords, or visitor IPs in errors/logs.
  json(res, 503, {
    error: error instanceof ConfigurationError
      ? 'El contador necesita configurarse. Revisa las variables de entorno indicadas en README.md.'
      : 'No pudimos conectar con el contador. Intenta de nuevo en unos segundos.'
  });
}

function resolveServices(services) {
  if (services) return services;
  const config = readConfig();
  return { config, store: new RedisStore(config), ip: clientIp, mode: 'live' };
}

export function createVisitsHandler(services) {
  return async (req, res) => {
    if (!['GET', 'POST'].includes(req.method)) {
      res.setHeader('Allow', 'GET, POST');
      return json(res, 405, { error: 'Método no permitido.' });
    }
    if (!sameOrigin(req)) return json(res, 403, { error: 'Origen no permitido.' });
    try {
      const { config, store, ip: getIp, mode } = resolveServices(services);
      const ip = getIp(req);
      if (!ip) return json(res, 400, { error: 'No pudimos reconocer tu dirección IP.' });
      const stats = req.method === 'POST'
        ? await store.record(ip, hashIp(ip, config.salt), new Date().toISOString())
        : await store.stats();
      return json(res, 200, { ...stats, ip, mode, updatedAt: new Date().toISOString() });
    } catch (error) {
      return failure(res, error);
    }
  };
}

export function createAdminHandler(services) {
  return async (req, res) => {
    if (req.method !== 'GET') {
      res.setHeader('Allow', 'GET');
      return json(res, 405, { error: 'Método no permitido.' });
    }
    if (!sameOrigin(req)) return json(res, 403, { error: 'Origen no permitido.' });
    try {
      const { config, store, ip: getIp, mode } = resolveServices(services);
      const header = req.headers.authorization || '';
      const password = header.startsWith('Bearer ') ? header.slice(7) : '';
      if (!password) return json(res, 401, { error: 'Ingresa tu contraseña de administración.' });
      if (password.length > 512 || !passwordMatches(password, config.password)) {
        const identity = hashIp(getIp(req) || 'unknown', config.salt);
        const attempts = await store.failedAttempt(identity);
        if (attempts > 10) {
          res.setHeader('Retry-After', '60');
          return json(res, 429, { error: 'Demasiados intentos. Espera un minuto antes de volver a intentar.' });
        }
        return json(res, 401, { error: 'La contraseña no es correcta.' });
      }
      return json(res, 200, { ...await store.admin(), mode, updatedAt: new Date().toISOString() });
    } catch (error) {
      return failure(res, error);
    }
  };
}
