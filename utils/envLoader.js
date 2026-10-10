'use strict';

const fs = require('fs');
const path = require('path');

// Le arquivos no formato CHAVE=valor. Nao sobrescreve variaveis ja definidas.
function parseEnv(text) {
  const out = {};
  const lines = String(text).split(/\r?\n/);
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 1) continue;
    const key = line.slice(0, eq).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
    let value = line.slice(eq + 1).trim();
    if (
      value.length >= 2 &&
      ((value[0] === '"' && value[value.length - 1] === '"') ||
        (value[0] === "'" && value[value.length - 1] === "'"))
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

// Procura ".env" e, se nao existir, "variables.env" na raiz do projeto.
function loadEnv(rootDir) {
  const candidates = ['.env', 'variables.env'];
  for (const name of candidates) {
    const file = path.join(rootDir, name);
    if (fs.existsSync(file)) {
      const parsed = parseEnv(fs.readFileSync(file, 'utf8'));
      for (const [k, v] of Object.entries(parsed)) {
        if (process.env[k] === undefined) process.env[k] = v;
      }
      return name;
    }
  }
  return null;
}

module.exports = { parseEnv, loadEnv };
