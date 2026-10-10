'use strict';

const crypto = require('crypto');
const config = require('../config');

// Criptografia AES-256-GCM para guardar tokens de bots e variaveis de ambiente.
const KEY = crypto.scryptSync(config.secret, 'botnexus-secret-box-v1', 32);

function encrypt(plainText) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', KEY, iv);
  const data = Buffer.concat([cipher.update(String(plainText), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return 'v1.' + iv.toString('base64') + '.' + tag.toString('base64') + '.' + data.toString('base64');
}

function decrypt(payload) {
  const parts = String(payload).split('.');
  if (parts.length !== 4 || parts[0] !== 'v1') throw new Error('Formato criptografado invalido.');
  const iv = Buffer.from(parts[1], 'base64');
  const tag = Buffer.from(parts[2], 'base64');
  const data = Buffer.from(parts[3], 'base64');
  const decipher = crypto.createDecipheriv('aes-256-gcm', KEY, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
}

module.exports = { encrypt, decrypt };
