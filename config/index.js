'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { loadEnv } = require('../utils/envLoader');

const rootDir = path.resolve(__dirname, '..', '..');
const envFileUsed = loadEnv(rootDir);

function toBool(value, fallback) {
  if (value === undefined || value === '') return fallback;
  return ['1', 'true', 'sim', 'yes', 'on'].includes(String(value).toLowerCase());
}

function toInt(value, fallback, min, max) {
  const n = parseInt(value, 10);
  if (Number.isNaN(n)) return fallback;
  return Math.min(Math.max(n, min), max);
}

const dataDir = path.resolve(rootDir, process.env.DATA_DIR || 'data');
fs.mkdirSync(dataDir, { recursive: true });

// Chave mestra: vem do ambiente ou e gerada uma vez e guardada em data/secret.key
function resolveSecret() {
  const fromEnv = (process.env.BOTNEXUS_SECRET || '').trim();
  if (fromEnv.length >= 32) return { value: fromEnv, source: 'env' };
  const file = path.join(dataDir, 'secret.key');
  if (fs.existsSync(file)) {
    const saved = fs.readFileSync(file, 'utf8').trim();
    if (saved.length >= 32) return { value: saved, source: 'arquivo' };
  }
  const generated = crypto.randomBytes(48).toString('hex');
  fs.writeFileSync(file, generated + '\n', { mode: 0o600 });
  return { value: generated, source: 'gerada' };
}

const secret = resolveSecret();
const nodeEnv = process.env.NODE_ENV || 'production';

const config = {
  rootDir,
  envFileUsed,
  nodeEnv,
  isProduction: nodeEnv === 'production',
  port: toInt(process.env.PORT, 3000, 1, 65535),
  host: process.env.HOST || '0.0.0.0',
  trustProxy: toBool(process.env.TRUST_PROXY, false),
  cookieSecure: toBool(process.env.COOKIE_SECURE, false),
  allowRegistration: toBool(process.env.ALLOW_REGISTRATION, true),
  sessionDays: toInt(process.env.SESSION_DAYS, 14, 1, 90),

  secret: secret.value,
  secretSource: secret.source,

  dataDir,
  dbFile: path.join(dataDir, 'botnexus.db'),
  botsDir: path.join(dataDir, 'bots'),
  tmpDir: path.join(dataDir, 'tmp'),
  npmCacheDir: path.join(dataDir, 'npm-cache'),
  publicDir: path.join(rootDir, 'public'),

  uploadMaxBytes: toInt(process.env.UPLOAD_MAX_MB, 10, 1, 200) * 1024 * 1024,
  extractMaxBytes: toInt(process.env.EXTRACT_MAX_MB, 100, 1, 1000) * 1024 * 1024,
  extractMaxFiles: toInt(process.env.EXTRACT_MAX_FILES, 5000, 10, 50000),

  globalMaxRunning: toInt(process.env.GLOBAL_MAX_RUNNING, 20, 1, 1000),
  botRunner: (process.env.BOT_RUNNER || 'process').toLowerCase() === 'docker' ? 'docker' : 'process',
  fsSandbox: (process.env.BOT_FS_SANDBOX || 'auto').toLowerCase(),
  dockerImage: process.env.DOCKER_IMAGE || 'node:22-alpine',

  logBufferLines: 500
};

for (const dir of [config.botsDir, config.tmpDir, config.npmCacheDir]) {
  fs.mkdirSync(dir, { recursive: true });
}

module.exports = config;
