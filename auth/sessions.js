'use strict';

const crypto = require('crypto');
const config = require('../config');
const db = require('../database/db');

const COOKIE_NAME = 'bn_session';

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

// O token em si so existe no cookie do navegador; no banco fica apenas o hash.
function createSession(userId, userAgent) {
  const token = crypto.randomBytes(32).toString('base64url');
  const now = Date.now();
  const expiresAt = now + config.sessionDays * 24 * 60 * 60 * 1000;
  db.run(
    'INSERT INTO sessions (user_id, token_hash, expires_at, created_at, user_agent) VALUES (?, ?, ?, ?, ?)',
    [userId, sha256(token), expiresAt, now, String(userAgent || '').slice(0, 200)]
  );
  return { token, expiresAt };
}

function findSession(token) {
  if (!token || typeof token !== 'string' || token.length > 200) return null;
  const row = db.get(
    'SELECT s.id AS session_id, s.expires_at, u.id, u.name, u.email, u.plan, u.created_at ' +
      'FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?',
    [sha256(token)]
  );
  if (!row) return null;
  if (row.expires_at < Date.now()) {
    db.run('DELETE FROM sessions WHERE id = ?', [row.session_id]);
    return null;
  }
  return row;
}

function destroySession(token) {
  if (!token) return;
  db.run('DELETE FROM sessions WHERE token_hash = ?', [sha256(token)]);
}

function purgeExpired() {
  db.run('DELETE FROM sessions WHERE expires_at < ?', [Date.now()]);
}

function parseCookies(header) {
  const out = {};
  if (!header) return out;
  for (const part of String(header).split(';')) {
    const idx = part.indexOf('=');
    if (idx < 1) continue;
    const key = part.slice(0, idx).trim();
    const value = part.slice(idx + 1).trim();
    try {
      out[key] = decodeURIComponent(value);
    } catch (e) {
      out[key] = value;
    }
  }
  return out;
}

function cookieOptions(maxAgeMs) {
  const parts = ['Path=/', 'HttpOnly', 'SameSite=Lax', 'Max-Age=' + Math.floor(maxAgeMs / 1000)];
  if (config.cookieSecure) parts.push('Secure');
  return parts.join('; ');
}

function setSessionCookie(res, token) {
  res.append('Set-Cookie', COOKIE_NAME + '=' + token + '; ' + cookieOptions(config.sessionDays * 24 * 60 * 60 * 1000));
}

function clearSessionCookie(res) {
  res.append('Set-Cookie', COOKIE_NAME + '=; ' + cookieOptions(0));
}

module.exports = {
  COOKIE_NAME,
  createSession,
  findSession,
  destroySession,
  purgeExpired,
  parseCookies,
  setSessionCookie,
  clearSessionCookie
};
