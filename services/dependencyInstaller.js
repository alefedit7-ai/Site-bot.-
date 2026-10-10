'use strict';

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const config = require('../config');
const store = require('./projectStore');

// Instala as dependencias do bot com um comando FIXO do npm:
//   npm install --omit=dev --ignore-scripts ...
// Scripts de instalacao ficam desligados e o package.json ja foi validado (so pacotes do registro).
// Nada que o usuario escreve vira comando.

function runInstall(botId, timeoutSec, onLine) {
  return new Promise((resolve) => {
    const cwd = store.projectDir(botId);
    const home = store.homeDir(botId);
    fs.mkdirSync(home, { recursive: true });

    const env = {
      PATH: process.env.PATH || '',
      HOME: home,
      npm_config_cache: config.npmCacheDir,
      npm_config_userconfig: path.join(home, 'npmrc-vazio'),
      npm_config_globalconfig: path.join(home, 'npmrc-vazio'),
      npm_config_ignore_scripts: 'true',
      npm_config_update_notifier: 'false',
      NODE_ENV: 'production'
    };
    const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
    const args = ['install', '--omit=dev', '--ignore-scripts', '--no-bin-links', '--no-audit', '--no-fund', '--no-package-lock', '--loglevel=error'];

    let child;
    try {
      child = spawn(npm, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    } catch (err) {
      return resolve({ ok: false, message: 'Nao foi possivel iniciar o npm neste servidor.' });
    }

    let finished = false;
    const finish = (result) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      resolve(result);
    };
    const timer = setTimeout(() => {
      try {
        child.kill('SIGKILL');
      } catch (e) {
        /* ja encerrou */
      }
      finish({ ok: false, message: 'A instalacao passou do limite de ' + timeoutSec + ' segundos e foi cancelada.' });
    }, timeoutSec * 1000);

    const pipeLines = (stream) => {
      let buffer = '';
      stream.on('data', (chunk) => {
        buffer += chunk.toString('utf8');
        let idx;
        while ((idx = buffer.indexOf('\n')) >= 0) {
          onLine(buffer.slice(0, idx));
          buffer = buffer.slice(idx + 1);
        }
        if (buffer.length > 4000) buffer = buffer.slice(-4000);
      });
    };
    pipeLines(child.stdout);
    pipeLines(child.stderr);

    child.on('error', () => finish({ ok: false, message: 'O npm nao foi encontrado neste servidor.' }));
    child.on('close', (code) => {
      if (code === 0) finish({ ok: true, message: 'Dependencias instaladas.' });
      else finish({ ok: false, message: 'O npm terminou com erro (codigo ' + code + '). Veja o console.' });
    });
  });
}

module.exports = { runInstall };
