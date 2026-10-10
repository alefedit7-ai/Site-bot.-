'use strict';

const { badRequest } = require('./errors');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const ENTRY_RE = /^[A-Za-z0-9_.\-\/]{1,120}\.(js|cjs|mjs)$/;
const ENV_KEY_RE = /^[A-Z_][A-Z0-9_]{0,63}$/;

// Variaveis que o usuario nao pode definir para o proprio bot.
const BLOCKED_ENV_KEYS = new Set([
  'PATH', 'HOME', 'NODE_OPTIONS', 'NODE_PATH', 'NODE_ENV', 'LD_PRELOAD', 'LD_LIBRARY_PATH',
  'DYLD_INSERT_LIBRARIES', 'DYLD_LIBRARY_PATH', 'BOTNEXUS', 'BOTNEXUS_SECRET', 'NODE_EXTRA_CA_CERTS',
  'NODE_TLS_REJECT_UNAUTHORIZED', 'DISCORD_TOKEN', 'TOKEN', 'SHELL', 'TMPDIR', 'TMP', 'TEMP'
]);

function asString(value) {
  return typeof value === 'string' ? value : '';
}

function validateName(value) {
  const name = asString(value).trim().replace(/\s+/g, ' ');
  if (name.length < 2 || name.length > 40) {
    throw badRequest('O nome precisa ter entre 2 e 40 caracteres.');
  }
  if (/[<>]/.test(name)) throw badRequest('O nome nao pode conter os caracteres < ou >.');
  return name;
}

function validateEmail(value) {
  const email = asString(value).trim().toLowerCase();
  if (email.length > 254 || !EMAIL_RE.test(email)) {
    throw badRequest('Informe um e-mail valido.');
  }
  return email;
}

function validatePassword(value) {
  const password = asString(value);
  if (password.length < 8) throw badRequest('A senha precisa ter pelo menos 8 caracteres.');
  if (password.length > 128) throw badRequest('A senha pode ter no maximo 128 caracteres.');
  if (!/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) {
    throw badRequest('A senha precisa ter pelo menos uma letra e um numero.');
  }
  return password;
}

function validateEntryFile(value) {
  const file = asString(value).trim();
  if (!ENTRY_RE.test(file) || file.includes('..') || file.startsWith('/') || file.includes('//')) {
    throw badRequest('Arquivo principal invalido. Use algo como index.js ou src/bot.js.');
  }
  return file;
}

function validateBotToken(value) {
  const token = asString(value).trim();
  if (token.length < 20 || token.length > 200 || /\s/.test(token)) {
    throw badRequest('O token informado nao parece valido.');
  }
  return token;
}

// Aceita um objeto { CHAVE: "valor" } e devolve uma copia validada.
function validateEnvVars(value) {
  if (value === undefined || value === null) return {};
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw badRequest('As variaveis de ambiente estao em formato invalido.');
  }
  const entries = Object.entries(value);
  if (entries.length > 30) throw badRequest('Maximo de 30 variaveis de ambiente por bot.');
  const out = {};
  for (const [key, val] of entries) {
    if (!ENV_KEY_RE.test(key)) {
      throw badRequest('Nome de variavel invalido: use letras maiusculas, numeros e _.');
    }
    if (BLOCKED_ENV_KEYS.has(key)) {
      throw badRequest('A variavel ' + key + ' e reservada pelo BotNexus.');
    }
    if (typeof val !== 'string' || val.length > 1000 || val.includes('\0')) {
      throw badRequest('O valor da variavel ' + key + ' e invalido (maximo 1000 caracteres).');
    }
    out[key] = val;
  }
  return out;
}

function parseId(value) {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1 || n > 2147483647) throw badRequest('Identificador invalido.');
  return n;
}

module.exports = {
  validateName,
  validateEmail,
  validatePassword,
  validateEntryFile,
  validateBotToken,
  validateEnvVars,
  parseId,
  BLOCKED_ENV_KEYS
};
