'use strict';

const express = require('express');
const config = require('../config');
const db = require('../database/db');
const asyncHandler = require('../utils/asyncHandler');
const passwords = require('../auth/passwords');
const sessions = require('../auth/sessions');
const security = require('../middleware/security');
const { requireAuth } = require('../middleware/auth');
const { validateName, validateEmail, validatePassword } = require('../utils/validators');
const { AppError, conflict, forbidden, tooMany } = require('../utils/errors');
const { DEFAULT_PLAN } = require('../services/plans');

const router = express.Router();

function publicUser(u) {
  return { id: u.id, name: u.name, email: u.email, plan: u.plan };
}

router.post(
  '/register',
  security.registerLimiter,
  asyncHandler(async (req, res) => {
    if (!config.allowRegistration) throw forbidden('Os cadastros estao fechados no momento.');
    const body = req.body || {};
    const name = validateName(body.name);
    const email = validateEmail(body.email);
    const password = validatePassword(body.password);

    const existing = db.get('SELECT id FROM users WHERE email = ?', [email]);
    if (existing) throw conflict('Este e-mail ja esta cadastrado. Tente entrar na sua conta.');

    const hash = await passwords.hashPassword(password);
    let userId;
    try {
      const result = db.run(
        'INSERT INTO users (name, email, password_hash, plan, created_at) VALUES (?, ?, ?, ?, ?)',
        [name, email, hash, DEFAULT_PLAN, Date.now()]
      );
      userId = Number(result.lastInsertRowid);
    } catch (err) {
      if (String(err.message).includes('UNIQUE')) throw conflict('Este e-mail ja esta cadastrado. Tente entrar na sua conta.');
      throw err;
    }

    const session = sessions.createSession(userId, req.get('user-agent'));
    sessions.setSessionCookie(res, session.token);
    res.status(201).json({ user: { id: userId, name, email, plan: DEFAULT_PLAN } });
  })
);

router.post(
  '/login',
  security.authLimiter,
  asyncHandler(async (req, res) => {
    const body = req.body || {};
    let email;
    try {
      email = validateEmail(body.email);
    } catch (e) {
      throw new AppError(401, 'E-mail ou senha incorretos.', 'credenciais_invalidas');
    }
    const password = typeof body.password === 'string' ? body.password.slice(0, 200) : '';

    const waitMs = security.loginLocked(email);
    if (waitMs > 0) throw tooMany('Muitas tentativas erradas. Tente novamente em ' + Math.ceil(waitMs / 60000) + ' minuto(s).');

    const user = db.get('SELECT id, name, email, password_hash, plan FROM users WHERE email = ?', [email]);
    const hashToCheck = user ? user.password_hash : await passwords.dummyHash();
    const ok = await passwords.verifyPassword(password, hashToCheck);
    if (!user || !ok) {
      security.registerLoginFailure(email);
      throw new AppError(401, 'E-mail ou senha incorretos.', 'credenciais_invalidas');
    }

    security.registerLoginSuccess(email);
    sessions.purgeExpired();
    const session = sessions.createSession(user.id, req.get('user-agent'));
    sessions.setSessionCookie(res, session.token);
    res.json({ user: publicUser(user) });
  })
);

router.post('/logout', (req, res) => {
  const cookies = sessions.parseCookies(req.headers.cookie);
  sessions.destroySession(cookies[sessions.COOKIE_NAME]);
  sessions.clearSessionCookie(res);
  res.json({ ok: true });
});

router.get('/me', requireAuth, (req, res) => {
  res.json({ user: publicUser(req.user) });
});

module.exports = router;
