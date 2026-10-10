'use strict';

const crypto = require('crypto');

// scrypt vem embutido no Node (sem pacotes nativos). Formato: scrypt$N$r$p$salt$hash
const N = 16384;
const R = 8;
const P = 1;
const KEYLEN = 64;

function scryptAsync(password, salt, params) {
  return new Promise((resolve, reject) => {
    crypto.scrypt(password, salt, KEYLEN, { N: params.N, r: params.r, p: params.p, maxmem: 64 * 1024 * 1024 }, (err, key) => {
      if (err) reject(err);
      else resolve(key);
    });
  });
}

async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const key = await scryptAsync(password, salt, { N, r: R, p: P });
  return ['scrypt', N, R, P, salt.toString('base64'), key.toString('base64')].join('$');
}

async function verifyPassword(password, stored) {
  try {
    const parts = String(stored).split('$');
    if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
    const params = { N: parseInt(parts[1], 10), r: parseInt(parts[2], 10), p: parseInt(parts[3], 10) };
    const salt = Buffer.from(parts[4], 'base64');
    const expected = Buffer.from(parts[5], 'base64');
    const actual = await scryptAsync(password, salt, params);
    return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
  } catch (err) {
    return false;
  }
}

// Hash falso usado para gastar o mesmo tempo quando o e-mail nao existe.
let dummyHashPromise = null;
function dummyHash() {
  if (!dummyHashPromise) dummyHashPromise = hashPassword('senha-falsa-' + crypto.randomBytes(8).toString('hex'));
  return dummyHashPromise;
}

module.exports = { hashPassword, verifyPassword, dummyHash };
