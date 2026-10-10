'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const config = require('../config');
const zip = require('./zipReader');
const { badRequest } = require('../utils/errors');

const ENTRY_CANDIDATES = ['index.js', 'bot.js', 'main.js', 'app.js', 'src/index.js', 'src/bot.js', 'src/main.js'];
const SKIP_AT_ROOT = new Set(['.npmrc', 'package-lock.json', 'npm-shrinkwrap.json', 'yarn.lock', 'pnpm-lock.yaml']);
const PACKAGE_NAME_RE = /^(@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/;
const VERSION_SPEC_RE = /^[A-Za-z0-9.\-+~^<>=*|\s]{1,80}$/;
const KEEP_PACKAGE_KEYS = ['name', 'version', 'description', 'main', 'type', 'dependencies', 'optionalDependencies', 'engines', 'license', 'author'];

function assertId(botId) {
  if (!Number.isInteger(botId) || botId < 1) throw new Error('botId invalido');
  return botId;
}

function botRoot(botId) {
  return path.join(config.botsDir, String(assertId(botId)));
}
function projectDir(botId) {
  return path.join(botRoot(botId), 'project');
}
function homeDir(botId) {
  return path.join(botRoot(botId), 'home');
}

function insideDir(base, target) {
  const rel = path.relative(base, target);
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
}

function dirSize(dir) {
  let total = 0;
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (e) {
    return 0;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    try {
      if (entry.isDirectory()) total += dirSize(full);
      else if (entry.isFile()) total += fs.statSync(full).size;
    } catch (e) {
      /* arquivo sumiu durante a leitura */
    }
  }
  return total;
}

function removeDir(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}

// Aceita somente dependencias vindas do registro npm (sem git:, file:, http:, github usuario/repo).
function checkDependencies(pkg) {
  for (const field of ['dependencies', 'optionalDependencies']) {
    const deps = pkg[field];
    if (deps === undefined) continue;
    if (typeof deps !== 'object' || deps === null || Array.isArray(deps)) {
      throw badRequest('package.json: o campo "' + field + '" esta invalido.');
    }
    for (const [name, spec] of Object.entries(deps)) {
      if (!PACKAGE_NAME_RE.test(name)) throw badRequest('package.json: nome de pacote invalido: ' + name);
      if (typeof spec !== 'string' || !VERSION_SPEC_RE.test(spec)) {
        throw badRequest('package.json: a versao de "' + name + '" nao e permitida. Use apenas versoes do npm (ex: ^14.16.0).');
      }
    }
  }
}

function sanitizePackageJson(pkg) {
  const clean = {};
  for (const key of KEEP_PACKAGE_KEYS) {
    if (pkg[key] !== undefined) clean[key] = pkg[key];
  }
  return clean;
}

function detectEntry(projectPath, pkg) {
  const list = [];
  if (pkg && typeof pkg.main === 'string' && /^[A-Za-z0-9_.\-\/]{1,120}\.(js|cjs|mjs)$/.test(pkg.main) && !pkg.main.includes('..')) {
    list.push(pkg.main.replace(/^\.\//, ''));
  }
  for (const c of ENTRY_CANDIDATES) list.push(c);
  for (const candidate of list) {
    const full = path.join(projectPath, candidate);
    if (insideDir(projectPath, full) && fs.existsSync(full) && fs.statSync(full).isFile()) return candidate;
  }
  return null;
}

/**
 * Valida o ZIP e instala o projeto do bot em data/bots/<id>/project.
 * So grava no disco depois que TODAS as validacoes passam.
 */
function installZip(botId, buffer, opts) {
  const maxTotalBytes = Math.min(config.extractMaxBytes, (opts && opts.diskMb ? opts.diskMb : 1000) * 1048576);
  const entries = zip.listEntries(buffer, { maxFiles: config.extractMaxFiles, maxTotalBytes });
  const wrapper = zip.detectWrapperFolder(entries);

  const root = botRoot(botId);
  fs.mkdirSync(root, { recursive: true });
  const staging = path.join(config.tmpDir, 'bot' + botId + '-' + crypto.randomBytes(6).toString('hex'));
  fs.mkdirSync(staging, { recursive: true });

  let fileCount = 0;
  try {
    for (const entry of entries) {
      let rel = entry.name;
      if (wrapper) rel = rel.slice(wrapper.length + 1);
      if (!rel) continue;
      if (!rel.includes('/') && SKIP_AT_ROOT.has(rel) && !entry.isDir) continue;

      const target = path.join(staging, rel);
      if (!insideDir(staging, target)) throw badRequest('Caminho invalido no ZIP.');
      if (entry.isDir) {
        fs.mkdirSync(target, { recursive: true });
        continue;
      }
      const data = zip.readEntry(buffer, entry);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, data, { mode: 0o644 });
      fileCount++;
    }

    // package.json: valida dependencias e grava uma copia limpa.
    let pkg = null;
    let hasPackageJson = false;
    const pkgFile = path.join(staging, 'package.json');
    if (fs.existsSync(pkgFile)) {
      hasPackageJson = true;
      try {
        pkg = JSON.parse(fs.readFileSync(pkgFile, 'utf8'));
      } catch (e) {
        throw badRequest('O package.json do ZIP nao e um JSON valido.');
      }
      if (typeof pkg !== 'object' || pkg === null || Array.isArray(pkg)) {
        throw badRequest('O package.json do ZIP esta em formato invalido.');
      }
      checkDependencies(pkg);
      fs.writeFileSync(pkgFile, JSON.stringify(sanitizePackageJson(pkg), null, 2) + '\n');
    }

    const entryFile = detectEntry(staging, pkg);
    if (!entryFile) {
      throw badRequest('Nao encontrei o arquivo principal do bot. Inclua um index.js (ou informe "main" no package.json).');
    }

    const hasNodeModules = fs.existsSync(path.join(staging, 'node_modules'));
    const needsInstall = hasPackageJson && !hasNodeModules && !!pkg && !!pkg.dependencies && Object.keys(pkg.dependencies).length > 0;

    // Troca a pasta antiga pela nova, mantendo a pasta "storage" do bot.
    const finalDir = projectDir(botId);
    const backup = path.join(config.tmpDir, 'old' + botId + '-' + crypto.randomBytes(6).toString('hex'));
    const hadOld = fs.existsSync(finalDir);
    if (hadOld) fs.renameSync(finalDir, backup);
    try {
      fs.renameSync(staging, finalDir);
    } catch (err) {
      if (hadOld) fs.renameSync(backup, finalDir);
      throw err;
    }
    if (hadOld) {
      const oldStorage = path.join(backup, 'storage');
      const newStorage = path.join(finalDir, 'storage');
      if (fs.existsSync(oldStorage) && !fs.existsSync(newStorage)) {
        try {
          fs.renameSync(oldStorage, newStorage);
        } catch (e) {
          /* se nao der para mover, segue sem a pasta storage */
        }
      }
      removeDir(backup);
    }

    return { entryFile, fileCount, sizeBytes: dirSize(finalDir), hasPackageJson, needsInstall };
  } finally {
    if (fs.existsSync(staging)) removeDir(staging);
  }
}

function hasProject(botId) {
  return fs.existsSync(projectDir(botId));
}

function projectFileExists(botId, relativePath) {
  const base = projectDir(botId);
  const full = path.join(base, relativePath);
  return insideDir(base, full) && fs.existsSync(full) && fs.statSync(full).isFile();
}

function removeBotFiles(botId) {
  removeDir(botRoot(botId));
}

function botDiskBytes(botId) {
  return dirSize(botRoot(botId));
}

module.exports = {
  botRoot,
  projectDir,
  homeDir,
  installZip,
  hasProject,
  projectFileExists,
  removeBotFiles,
  botDiskBytes,
  dirSize,
  checkDependencies,
  sanitizePackageJson,
  detectEntry,
  insideDir
};
