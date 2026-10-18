import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { isIP } from 'node:net';

export function normalizeIp(value) {
  let ip = String(value ?? '').split(',')[0].trim();
  if (ip.startsWith('::ffff:') && isIP(ip.slice(7)) === 4) ip = ip.slice(7);
  if (!isIP(ip)) return null;
  // URL normalizes equivalent IPv6 spellings to the same identity.
  return isIP(ip) === 6 ? new URL(`http://[${ip}]/`).hostname.slice(1, -1) : ip;
}

export function clientIp(req, onVercel = process.env.VERCEL === '1') {
  // Forwarded headers are only trusted behind Vercel's managed proxy.
  const value = onVercel
    ? req.headers['x-vercel-forwarded-for'] || req.headers['x-forwarded-for']
    : req.socket?.remoteAddress;
  return normalizeIp(value);
}

export function hashIp(ip, salt) {
  return createHmac('sha256', salt).update(ip).digest('hex');
}

export function passwordMatches(actual, expected) {
  const digest = value => createHash('sha256').update(value).digest();
  return timingSafeEqual(digest(actual), digest(expected));
}

export function sameOrigin(req) {
  if (req.headers['sec-fetch-site'] === 'cross-site') return false;
  const origin = req.headers.origin;
  if (!origin) return true;
  try {
    return new URL(origin).host === req.headers.host;
  } catch {
    return false;
  }
}
