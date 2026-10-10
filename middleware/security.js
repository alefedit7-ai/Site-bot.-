'use strict';

const config = require('../config');
const { tooMany, forbidden } = require('../utils/errors');

// ---------- cabecalhos de seguranca ----------
function securityHeaders(req, res, next) {
  res.removeHeader('X-Powered-By');
  res.setHeader(
    'Content-Security-Policy',
    [
      "default-src 'self'",
      "script-src 'self'",
      "style-src 'self' https://fonts.googleapis.com",
      "font-src 'self' https://fonts.gstatic.com",
      "img-src 'self' data:",
      "connect-src 'self'",
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "frame-ancestors 'none'"
    ].join('; ')
  );
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()');
  if (config.cookieSecure) res.setHeader('Strict-Transport-Security', 'max-age=15552000; includeSubDomains');
  next();
}

function noStoreApi(req, res, next) {
  res.setHeader('Cache-Control', 'no-store');
  next();
}

// ---------- protecao contra CSRF ----------
// Pedidos que alteram dados precisam do cabecalho X-Requested-With (um site de terceiros nao
// consegue enviar isso sem permissao) e, se houver Origin, ele precisa ser o mesmo host.
function csrfGuard(req, res, next) {
  const safe = req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS';
  if (safe) return next();
  if (req.get('x-requested-with') !== 'BotNexus') {
    return next(forbidden('Pedido bloqueado por seguranca. Recarregue a pagina e tente de novo.'));
  }
  const origin = req.get('origin');
  if (origin) {
    let originHost = '';
    try {
      originHost = new URL(origin).host;
    } catch (e) {
      return next(forbidden('Origem do pedido invalida.'));
    }
    if (originHost !== req.get('host')) return next(forbidden('Origem do pedido nao permitida.'));
  }
  next();
}

// ---------- limite de requisicoes (em memoria) ----------
function createRateLimiter(options) {
  const hits = new Map();
  const windowMs = options.windowMs;
  const max = options.max;
  const keyFn = options.keyFn || ((req) => req.ip);
  const message = options.message;

  const sweep = setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of hits) {
      if (entry.resetAt <= now) hits.delete(key);
    }
  }, Math.max(windowMs, 60000));
  sweep.unref();

  function limiter(req, res, next) {
    const key = keyFn(req);
    const now = Date.now();
    let entry = hits.get(key);
    if (!entry || entry.resetAt <= now) {
      entry = { count: 0, resetAt: now + windowMs };
      hits.set(key, entry);
    }
    entry.count++;
    if (entry.count > max) {
      res.setHeader('Retry-After', String(Math.ceil((entry.resetAt - now) / 1000)));
      return next(tooMany(message));
    }
    next();
  }
  limiter.reset = (key) => hits.delete(key);
  limiter.hits = hits;
  return limiter;
}

const apiLimiter = createRateLimiter({
  windowMs: 60 * 1000,
  max: 300,
  message: 'Voce fez pedidos demais em pouco tempo. Aguarde um minuto.'
});

const authLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: 'Muitas tentativas de entrada. Tente novamente em alguns minutos.'
});

const registerLimiter = createRateLimiter({
  windowMs: 60 * 60 * 1000,
  max: 10,
  message: 'Muitos cadastros deste endereco. Tente novamente mais tarde.'
});

const uploadLimiter = createRateLimiter({
  windowMs: 60 * 60 * 1000,
  max: 20,
  keyFn: (req) => 'u' + (req.user ? req.user.id : req.ip),
  message: 'Limite de envios por hora atingido. Tente novamente mais tarde.'
});

const actionLimiter = createRateLimiter({
  windowMs: 60 * 1000,
  max: 30,
  keyFn: (req) => 'u' + (req.user ? req.user.id : req.ip),
  message: 'Muitas acoes seguidas. Aguarde um instante.'
});

// Bloqueio por e-mail apos varias senhas erradas.
const failedLogins = new Map();
const MAX_FAILS = 6;
const LOCK_MS = 15 * 60 * 1000;

function loginLocked(email) {
  const entry = failedLogins.get(email);
  if (!entry) return 0;
  if (entry.lockedUntil && entry.lockedUntil > Date.now()) return entry.lockedUntil - Date.now();
  if (entry.lockedUntil && entry.lockedUntil <= Date.now()) failedLogins.delete(email);
  return 0;
}

function registerLoginFailure(email) {
  const entry = failedLogins.get(email) || { fails: 0, lockedUntil: 0 };
  entry.fails++;
  if (entry.fails >= MAX_FAILS) {
    entry.lockedUntil = Date.now() + LOCK_MS;
    entry.fails = 0;
  }
  failedLogins.set(email, entry);
}

function registerLoginSuccess(email) {
  failedLogins.delete(email);
}

module.exports = {
  securityHeaders,
  noStoreApi,
  csrfGuard,
  createRateLimiter,
  apiLimiter,
  authLimiter,
  registerLimiter,
  uploadLimiter,
  actionLimiter,
  loginLocked,
  registerLoginFailure,
  registerLoginSuccess
};
