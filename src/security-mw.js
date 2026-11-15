'use strict';
const crypto = require('node:crypto');

/* ---------- limite de pedidos por IP (memória; suficiente para 1 instalação = 1 processo) ---------- */
const buckets = new Map();
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of buckets) if (v.reset < now) buckets.delete(k);
}, 60_000).unref();

function hit(key, max, windowMs) {
  const now = Date.now();
  let b = buckets.get(key);
  if (!b || b.reset < now) { b = { n: 0, reset: now + windowMs }; buckets.set(key, b); }
  b.n++;
  return { ok: b.n <= max, retry: Math.ceil((b.reset - now) / 1000) };
}

function rateLimit(name, max, windowMs) {
  return (req, res, next) => {
    if (process.env.RATE_LIMIT === '0') return next();
    const r = hit(`${name}:${req.ip}`, max, windowMs);
    if (r.ok) return next();
    res.set('Retry-After', String(r.retry));
    if (req.path.startsWith('/api') || req.xhr || (req.headers.accept || '').includes('json')) {
      return res.status(429).json({ error: 'Demasiados pedidos. Tente daqui a pouco.' });
    }
    res.status(429).render('public/message', { code: '429', title: res.locals.L ? res.locals.L('rl.title') : 'Demasiados pedidos', text: res.locals.L ? res.locals.L('rl.text') : 'Aguarde um pouco e tente novamente.' });
  };
}

/* ---------- Cloudflare Turnstile (opcional: só ativo com as chaves no ambiente) ---------- */
const turnstileOn = () => !!(process.env.TURNSTILE_SITE_KEY && process.env.TURNSTILE_SECRET_KEY);
async function verifyTurnstile(req) {
  if (!turnstileOn()) return true;
  const token = req.body['cf-turnstile-response'];
  if (!token) return false;
  try {
    const r = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      body: new URLSearchParams({ secret: process.env.TURNSTILE_SECRET_KEY, response: token, remoteip: req.ip }),
    });
    return !!(await r.json()).success;
  } catch {
    return true; // se o Cloudflare falhar, não bloquear marcações reais (o rate limit continua ativo)
  }
}

/* ---------- cabeçalhos de segurança + nonce para scripts inline ---------- */
function securityHeaders(req, res, next) {
  const nonce = crypto.randomBytes(16).toString('base64');
  res.locals.nonce = nonce;
  res.locals.turnstileKey = turnstileOn() ? process.env.TURNSTILE_SITE_KEY : '';
  const prod = process.env.NODE_ENV === 'production';
  res.set('Content-Security-Policy', [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' https://challenges.cloudflare.com`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    "connect-src 'self'",
    'frame-src https://challenges.cloudflare.com',
    "form-action 'self' https://checkout.stripe.com",
    "base-uri 'self'",
    "object-src 'none'",
    "frame-ancestors 'self'",
    "manifest-src 'self'",
    "worker-src 'self'",
    ...(prod ? ['upgrade-insecure-requests'] : []),
  ].join('; '));
  res.set('X-Content-Type-Options', 'nosniff');
  res.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.set('X-Frame-Options', 'SAMEORIGIN');
  res.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), interest-cohort=()');
  res.set('Cross-Origin-Opener-Policy', 'same-origin');
  if (prod) res.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  next();
}

module.exports = { rateLimit, verifyTurnstile, turnstileOn, securityHeaders };
