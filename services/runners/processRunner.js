'use strict';

const { spawn, spawnSync } = require('child_process');
const config = require('../../config');
const stats = require('../processStats');
const { AppError } = require('../../utils/errors');

// Executor por processo restrito.
// - Roda "node" com argumentos fixos (nunca um comando vindo do usuario).
// - Ambiente minimo: nenhum segredo do servidor e repassado ao bot.
// - Quando o Node suporta, usa o modelo de permissoes: o bot so le/escreve na propria pasta
//   e nao pode abrir processos filhos, workers ou addons nativos.
// IMPORTANTE: isto NAO e um container. O bot ainda roda com o mesmo usuario do sistema e
// tem acesso a rede. Para isolamento forte use BOT_RUNNER=docker em um servidor com Docker.

let permissionFlag;

function detectPermissionFlag() {
  if (permissionFlag !== undefined) return permissionFlag;
  permissionFlag = null;
  if (config.fsSandbox === 'off') return permissionFlag;
  for (const flag of ['--permission', '--experimental-permission']) {
    try {
      const result = spawnSync(process.execPath, [flag, '--allow-fs-read=' + config.tmpDir, '-e', '0'], { timeout: 8000 });
      if (result.status === 0) {
        permissionFlag = flag;
        break;
      }
    } catch (e) {
      /* tenta a proxima flag */
    }
  }
  return permissionFlag;
}

function info() {
  const flag = detectPermissionFlag();
  return {
    runner: 'process',
    fileSandbox: !!flag,
    description: flag
      ? 'Processo restrito com permissoes de arquivo limitadas a pasta do bot.'
      : 'Processo comum com ambiente reduzido (sem restricao de arquivos).'
  };
}

// spec: { botRoot, projectDir, entryFile, env, memoryMb }
function spawnBot(spec) {
  const flag = detectPermissionFlag();
  if (config.fsSandbox === 'on' && !flag) {
    throw new AppError(
      500,
      'O servidor exige o sandbox de arquivos (BOT_FS_SANDBOX=on), mas esta versao do Node nao suporta. Atualize o Node ou use BOT_FS_SANDBOX=auto.',
      'sandbox_indisponivel'
    );
  }
  const args = [];
  if (flag) {
    args.push(flag, '--allow-fs-read=' + spec.botRoot, '--allow-fs-write=' + spec.botRoot);
  }
  args.push('--max-old-space-size=' + Math.max(32, Math.floor(spec.memoryMb * 0.7)));
  args.push(spec.entryFile);

  return spawn(process.execPath, args, {
    cwd: spec.projectDir,
    env: spec.env,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true
  });
}

function sample(child) {
  return stats.sample(child.pid);
}

function stop(child, signal) {
  try {
    child.kill(signal);
  } catch (e) {
    /* ja encerrou */
  }
}

function cleanup(child) {
  stats.forget(child.pid);
}

module.exports = { name: 'process', info, spawnBot, sample, stop, cleanup };
