'use strict';

const { spawn, execFile, spawnSync } = require('child_process');
const config = require('../../config');
const { AppError } = require('../../utils/errors');

// Executor por container Docker (isolamento forte). Requer Docker instalado e acessivel
// ao usuario que roda o BotNexus. Nao funciona no Termux/Android.
// Cada bot recebe: limite de memoria, CPU, processos, sistema de arquivos somente leitura
// (exceto a pasta do projeto e /tmp), sem capacidades extras e sem novos privilegios.

function containerName(botId) {
  return 'botnexus-bot-' + Number(botId);
}

function dockerAvailable() {
  try {
    const r = spawnSync('docker', ['version', '--format', '{{.Server.Version}}'], { timeout: 8000 });
    return r.status === 0;
  } catch (e) {
    return false;
  }
}

function info() {
  const ok = dockerAvailable();
  return {
    runner: 'docker',
    fileSandbox: ok,
    description: ok ? 'Container Docker com limites de recursos.' : 'Docker nao esta disponivel neste servidor.'
  };
}

// spec: { botId, projectDir, entryFile, env, memoryMb }
function spawnBot(spec) {
  if (!dockerAvailable()) {
    throw new AppError(500, 'Docker nao esta disponivel neste servidor. Use BOT_RUNNER=process ou instale o Docker.', 'docker_indisponivel');
  }
  const name = containerName(spec.botId);
  const args = [
    'run', '--rm', '--init',
    '--name', name,
    '--memory', spec.memoryMb + 'm',
    '--memory-swap', spec.memoryMb + 'm',
    '--cpus', '0.5',
    '--pids-limit', '128',
    '--read-only',
    '--tmpfs', '/tmp:rw,size=32m,noexec',
    '--cap-drop', 'ALL',
    '--security-opt', 'no-new-privileges',
    '-v', spec.projectDir + ':/app',
    '-w', '/app'
  ];
  if (typeof process.getuid === 'function') {
    args.push('--user', process.getuid() + ':' + process.getgid());
  }
  // "-e CHAVE" sem valor: o Docker le o valor do ambiente deste processo (nao aparece no ps).
  const hostOnly = new Set(['PATH', 'HOME', 'TMPDIR']);
  for (const key of Object.keys(spec.env)) {
    if (!hostOnly.has(key) && /^[A-Z_][A-Z0-9_]*$/.test(key)) args.push('-e', key);
  }
  args.push(config.dockerImage, 'node', '--max-old-space-size=' + Math.max(32, Math.floor(spec.memoryMb * 0.7)), spec.entryFile);

  const cliEnv = Object.assign({}, spec.env);
  for (const key of ['DOCKER_HOST', 'XDG_RUNTIME_DIR']) {
    if (process.env[key]) cliEnv[key] = process.env[key];
  }
  return spawn('docker', args, { env: cliEnv, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
}

function sample(child, botId) {
  return new Promise((resolve) => {
    execFile(
      'docker',
      ['stats', '--no-stream', '--format', '{{.MemUsage}}|{{.CPUPerc}}', containerName(botId)],
      { timeout: 8000 },
      (err, stdout) => {
        if (err || !stdout) return resolve(null);
        const [mem, cpu] = stdout.trim().split('|');
        const match = /^([\d.]+)\s*(KiB|MiB|GiB)/.exec(mem || '');
        if (!match) return resolve(null);
        const factor = { KiB: 1 / 1024, MiB: 1, GiB: 1024 }[match[2]];
        resolve({ memoryMb: Math.round(parseFloat(match[1]) * factor * 10) / 10, cpuPercent: parseFloat(cpu) || 0 });
      }
    );
  });
}

function stop(child, signal, botId) {
  if (signal === 'SIGKILL') {
    execFile('docker', ['kill', containerName(botId)], { timeout: 8000 }, () => {});
  } else {
    execFile('docker', ['stop', '-t', '5', containerName(botId)], { timeout: 15000 }, () => {});
  }
}

function cleanup() {}

module.exports = { name: 'docker', info, spawnBot, sample, stop, cleanup };
