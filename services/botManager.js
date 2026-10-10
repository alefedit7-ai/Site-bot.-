'use strict';

const fs = require('fs');
const path = require('path');
const config = require('../config');
const db = require('../database/db');
const store = require('./projectStore');
const secretBox = require('../auth/secretBox');
const plans = require('./plans');
const installer = require('./dependencyInstaller');
const logger = require('../utils/logger');
const { createRedactor } = require('../utils/redact');
const { badRequest, conflict, notFound } = require('../utils/errors');

const runner = config.botRunner === 'docker' ? require('./runners/dockerRunner') : require('./runners/processRunner');

const MONITOR_INTERVAL_MS = 5000;
const DISK_CHECK_EVERY_TICKS = 12;
const STARTUP_GRACE_MS = 2500;
const GRACEFUL_STOP_MS = 5000;
const MAX_LINE_LENGTH = 2000;
const MAX_LINES_PER_SECOND = 300;
const RESTART_WINDOW_MS = 10 * 60 * 1000;
const MAX_AUTO_RESTARTS = 5;

const runtimes = new Map();

function getRuntime(botId) {
  let rt = runtimes.get(botId);
  if (!rt) {
    rt = {
      botId,
      child: null,
      status: 'stopped',
      startedAt: null,
      stopping: false,
      killReason: null,
      logs: [],
      seq: 0,
      listeners: new Set(),
      memoryMb: 0,
      cpuPercent: 0,
      overLimitTicks: 0,
      tick: 0,
      monitorTimer: null,
      graceTimer: null,
      killTimer: null,
      restartTimer: null,
      restartTimes: [],
      exitWaiters: [],
      redact: createRedactor([]),
      windowStart: 0,
      windowCount: 0,
      dropped: 0
    };
    runtimes.set(botId, rt);
  }
  return rt;
}

// ---------- logs ----------

function emit(rt, event) {
  for (const listener of rt.listeners) {
    try {
      listener(event);
    } catch (e) {
      rt.listeners.delete(listener);
    }
  }
}

function pushLine(rt, stream, text) {
  const now = Date.now();
  if (now - rt.windowStart >= 1000) {
    if (rt.dropped > 0) {
      const note = { id: ++rt.seq, t: now, s: 'sistema', m: rt.dropped + ' linhas foram descartadas por excesso de saida.' };
      rt.logs.push(note);
      emit(rt, { type: 'log', data: note });
      rt.dropped = 0;
    }
    rt.windowStart = now;
    rt.windowCount = 0;
  }
  rt.windowCount++;
  if (rt.windowCount > MAX_LINES_PER_SECOND) {
    rt.dropped++;
    return;
  }
  let message = rt.redact(text.length > MAX_LINE_LENGTH ? text.slice(0, MAX_LINE_LENGTH) + '...' : text);
  const entry = { id: ++rt.seq, t: now, s: stream, m: message };
  rt.logs.push(entry);
  if (rt.logs.length > config.logBufferLines) rt.logs.splice(0, rt.logs.length - config.logBufferLines);
  emit(rt, { type: 'log', data: entry });
}

function systemLog(botId, text) {
  pushLine(getRuntime(botId), 'sistema', text);
}

function lineSplitter(rt, stream) {
  let buffer = '';
  return {
    write(chunk) {
      buffer += chunk.toString('utf8');
      let idx;
      while ((idx = buffer.indexOf('\n')) >= 0) {
        pushLine(rt, stream, buffer.slice(0, idx).replace(/\r$/, ''));
        buffer = buffer.slice(idx + 1);
      }
      if (buffer.length > MAX_LINE_LENGTH * 2) {
        pushLine(rt, stream, buffer);
        buffer = '';
      }
    },
    flush() {
      if (buffer.length) pushLine(rt, stream, buffer);
      buffer = '';
    }
  };
}

function getLogs(botId, afterId) {
  const rt = getRuntime(botId);
  const after = Number.isInteger(afterId) ? afterId : 0;
  return rt.logs.filter((l) => l.id > after);
}

function subscribe(botId, listener) {
  const rt = getRuntime(botId);
  rt.listeners.add(listener);
  return () => rt.listeners.delete(listener);
}

// ---------- status ----------

function setStatus(rt, status) {
  rt.status = status;
  db.run('UPDATE bots SET status = ?, updated_at = ? WHERE id = ?', [status, Date.now(), rt.botId]);
  emit(rt, { type: 'status', data: describe(rt.botId) });
}

function describe(botId) {
  const rt = getRuntime(botId);
  const live = rt.status === 'running' || rt.status === 'starting';
  return {
    status: rt.status,
    uptimeSeconds: rt.status === 'running' && rt.startedAt ? Math.floor((Date.now() - rt.startedAt) / 1000) : 0,
    memoryMb: live ? rt.memoryMb : 0,
    cpuPercent: live ? rt.cpuPercent : 0
  };
}

function loadBotWithPlan(botId) {
  const bot = db.get(
    'SELECT b.id, b.user_id, b.name, b.entry_file, b.token_enc, b.env_enc, b.auto_restart, b.has_project, u.plan AS user_plan ' +
      'FROM bots b JOIN users u ON u.id = b.user_id WHERE b.id = ?',
    [botId]
  );
  if (!bot) throw notFound('Bot nao encontrado.');
  return bot;
}

function countRunning() {
  let n = 0;
  for (const rt of runtimes.values()) {
    if (rt.status === 'running' || rt.status === 'starting' || rt.status === 'stopping') n++;
  }
  return n;
}

// ---------- ciclo de vida ----------

function buildEnv(botId, token, userEnv) {
  const home = store.homeDir(botId);
  const tmp = path.join(home, 'tmp');
  fs.mkdirSync(tmp, { recursive: true });
  const env = {
    PATH: process.env.PATH || '',
    HOME: home,
    TMPDIR: tmp,
    TZ: process.env.TZ || 'America/Sao_Paulo',
    NODE_ENV: 'production',
    BOTNEXUS: '1'
  };
  Object.assign(env, userEnv);
  env.DISCORD_TOKEN = token;
  env.TOKEN = token;
  return env;
}

function startBot(botId) {
  const rt = getRuntime(botId);
  if (['running', 'starting', 'stopping', 'installing'].includes(rt.status)) {
    throw conflict(rt.status === 'installing' ? 'Aguarde a instalacao das dependencias terminar.' : 'O bot ja esta em execucao.');
  }
  const bot = loadBotWithPlan(botId);
  const plan = plans.getPlan(bot.user_plan);

  if (!bot.has_project || !store.hasProject(botId)) {
    throw badRequest('Envie o ZIP do bot na aba Deploy antes de iniciar.');
  }
  if (!bot.token_enc) {
    throw badRequest('Configure o token do bot na aba Configuracoes antes de iniciar.');
  }
  if (!store.projectFileExists(botId, bot.entry_file)) {
    throw badRequest('O arquivo principal "' + bot.entry_file + '" nao existe no projeto. Ajuste em Configuracoes ou envie o ZIP de novo.');
  }
  const runningOfUser = db.get(
    "SELECT COUNT(*) AS n FROM bots WHERE user_id = ? AND id != ? AND status IN ('running','starting','stopping')",
    [bot.user_id, botId]
  ).n;
  if (runningOfUser >= plan.maxRunningBots) {
    throw badRequest('Seu plano permite ' + plan.maxRunningBots + ' bot(s) ligado(s) ao mesmo tempo. Pare outro bot primeiro.', 'limite_do_plano');
  }
  if (countRunning() >= config.globalMaxRunning) {
    throw badRequest('O servidor atingiu o limite de bots ligados no momento. Tente novamente mais tarde.', 'servidor_cheio');
  }

  let token;
  let userEnv = {};
  try {
    token = secretBox.decrypt(bot.token_enc);
    if (bot.env_enc) userEnv = JSON.parse(secretBox.decrypt(bot.env_enc));
  } catch (err) {
    throw badRequest('Nao foi possivel ler o token salvo. Salve o token novamente em Configuracoes.');
  }

  rt.redact = createRedactor([token].concat(Object.values(userEnv)));
  rt.stopping = false;
  rt.killReason = null;
  rt.memoryMb = 0;
  rt.cpuPercent = 0;
  rt.overLimitTicks = 0;
  rt.tick = 0;

  const spec = {
    botId,
    botRoot: store.botRoot(botId),
    projectDir: store.projectDir(botId),
    entryFile: bot.entry_file,
    env: buildEnv(botId, token, userEnv),
    memoryMb: plan.memoryMb
  };

  let child;
  try {
    child = runner.spawnBot(spec);
  } catch (err) {
    throw err.status ? err : badRequest('Nao foi possivel iniciar o bot neste servidor.');
  }

  rt.child = child;
  rt.startedAt = Date.now();
  db.run('UPDATE bots SET last_started_at = ? WHERE id = ?', [rt.startedAt, botId]);
  systemLog(botId, 'Iniciando ' + bot.entry_file + ' (' + runner.name + ')...');
  setStatus(rt, 'starting');

  const out = lineSplitter(rt, 'stdout');
  const err = lineSplitter(rt, 'stderr');
  child.stdout.on('data', (c) => out.write(c));
  child.stderr.on('data', (c) => err.write(c));

  let exited = false;
  child.on('error', (e) => {
    if (exited) return;
    systemLog(botId, 'Falha ao iniciar o processo do bot.');
    logger.error('Bot ' + botId + ' erro de spawn:', e.message);
    if (!child.pid) {
      exited = true;
      handleExit(rt, child, 1, null);
    }
  });
  child.on('close', (code, signal) => {
    if (exited) return;
    exited = true;
    out.flush();
    err.flush();
    handleExit(rt, child, code, signal);
  });

  rt.graceTimer = setTimeout(() => {
    if (rt.child === child && rt.status === 'starting') setStatus(rt, 'running');
  }, STARTUP_GRACE_MS);

  rt.monitorTimer = setInterval(() => monitor(rt, child, plan), MONITOR_INTERVAL_MS);
  rt.monitorTimer.unref();
  return describe(botId);
}

async function monitor(rt, child, plan) {
  if (rt.child !== child) return;
  rt.tick++;
  try {
    const s = await runner.sample(child, rt.botId);
    if (rt.child !== child) return;
    if (s) {
      rt.memoryMb = s.memoryMb;
      rt.cpuPercent = s.cpuPercent;
      if (s.memoryMb > plan.memoryMb) rt.overLimitTicks++;
      else rt.overLimitTicks = 0;
      if (rt.overLimitTicks >= 2 && !rt.killReason) {
        rt.killReason = 'memoria';
        systemLog(rt.botId, 'Limite de memoria do plano (' + plan.memoryMb + ' MB) excedido. Encerrando o bot.');
        forceKill(rt);
      }
    }
    if (rt.tick % DISK_CHECK_EVERY_TICKS === 0 && !rt.killReason) {
      const usedMb = store.botDiskBytes(rt.botId) / 1048576;
      if (usedMb > plan.diskMb * 1.5) {
        rt.killReason = 'disco';
        systemLog(rt.botId, 'Limite de disco do plano (' + plan.diskMb + ' MB) excedido. Encerrando o bot.');
        forceKill(rt);
      }
    }
  } catch (e) {
    /* falha de leitura de recursos nao derruba o bot */
  }
}

function forceKill(rt) {
  if (rt.child) runner.stop(rt.child, 'SIGKILL', rt.botId);
}

function clearTimers(rt) {
  for (const key of ['monitorTimer']) {
    if (rt[key]) clearInterval(rt[key]);
    rt[key] = null;
  }
  for (const key of ['graceTimer', 'killTimer']) {
    if (rt[key]) clearTimeout(rt[key]);
    rt[key] = null;
  }
}

function handleExit(rt, child, code, signal) {
  if (rt.child !== child) return;
  clearTimers(rt);
  runner.cleanup(child, rt.botId);
  rt.child = null;
  const wasStopping = rt.stopping;
  const reason = rt.killReason;
  rt.stopping = false;
  rt.memoryMb = 0;
  rt.cpuPercent = 0;

  const waiters = rt.exitWaiters;
  rt.exitWaiters = [];

  if (wasStopping && !reason) {
    systemLog(rt.botId, 'Bot parado.');
    setStatus(rt, 'stopped');
  } else if (reason) {
    setStatus(rt, 'crashed');
  } else if (code === 0) {
    systemLog(rt.botId, 'O bot terminou sozinho (codigo 0).');
    setStatus(rt, 'stopped');
  } else {
    systemLog(rt.botId, 'O bot encerrou com erro (codigo ' + (code === null ? signal : code) + ').');
    setStatus(rt, 'crashed');
    scheduleAutoRestart(rt);
  }
  for (const w of waiters) w();
}

function scheduleAutoRestart(rt) {
  const row = db.get('SELECT auto_restart FROM bots WHERE id = ?', [rt.botId]);
  if (!row || !row.auto_restart) return;
  const now = Date.now();
  rt.restartTimes = rt.restartTimes.filter((t) => now - t < RESTART_WINDOW_MS);
  if (rt.restartTimes.length >= MAX_AUTO_RESTARTS) {
    systemLog(rt.botId, 'Muitas falhas seguidas. A reinicializacao automatica foi pausada; corrija o bot e inicie manualmente.');
    return;
  }
  const delay = Math.min(30000, 2000 * Math.pow(2, rt.restartTimes.length));
  rt.restartTimes.push(now);
  systemLog(rt.botId, 'Reiniciando automaticamente em ' + Math.round(delay / 1000) + 's...');
  rt.restartTimer = setTimeout(() => {
    rt.restartTimer = null;
    try {
      startBot(rt.botId);
    } catch (e) {
      systemLog(rt.botId, 'Nao foi possivel reiniciar automaticamente: ' + e.message);
    }
  }, delay);
}

function waitForExit(rt, ms) {
  return new Promise((resolve) => {
    if (!rt.child) return resolve();
    const timer = setTimeout(resolve, ms);
    rt.exitWaiters.push(() => {
      clearTimeout(timer);
      resolve();
    });
  });
}

async function stopBot(botId) {
  const rt = getRuntime(botId);
  if (rt.restartTimer) {
    clearTimeout(rt.restartTimer);
    rt.restartTimer = null;
  }
  if (!rt.child) {
    if (rt.status !== 'stopped') setStatus(rt, 'stopped');
    return describe(botId);
  }
  if (rt.status !== 'stopping') {
    rt.stopping = true;
    setStatus(rt, 'stopping');
    systemLog(botId, 'Parando o bot...');
    runner.stop(rt.child, 'SIGTERM', botId);
    rt.killTimer = setTimeout(() => forceKill(rt), GRACEFUL_STOP_MS);
  }
  await waitForExit(rt, GRACEFUL_STOP_MS + 4000);
  return describe(botId);
}

async function restartBot(botId) {
  await stopBot(botId);
  return startBot(botId);
}

// Faz as verificacoes na hora e roda o npm em segundo plano (pode levar minutos).
function install(botId) {
  const rt = getRuntime(botId);
  if (['running', 'starting', 'stopping', 'installing'].includes(rt.status)) {
    throw conflict('Pare o bot (ou aguarde a instalacao atual) antes de instalar dependencias.');
  }
  const bot = loadBotWithPlan(botId);
  if (!bot.has_project || !store.hasProject(botId)) throw badRequest('Envie o ZIP do bot antes de instalar dependencias.');
  if (!store.projectFileExists(botId, 'package.json')) throw badRequest('O projeto nao tem package.json.');
  const plan = plans.getPlan(bot.user_plan);

  setStatus(rt, 'installing');
  systemLog(botId, 'Instalando dependencias (npm install)...');
  installer
    .runInstall(botId, plan.installTimeoutSec, (line) => {
      if (line.trim()) pushLine(rt, 'npm', line);
    })
    .then((result) => {
      systemLog(botId, result.message);
      setStatus(rt, 'stopped');
    })
    .catch((err) => {
      logger.error('Falha na instalacao do bot ' + botId + ':', err.message);
      systemLog(botId, 'A instalacao falhou.');
      setStatus(rt, 'stopped');
    });
  return describe(botId);
}

async function deleteBot(botId) {
  const rt = getRuntime(botId);
  await stopBot(botId);
  clearTimers(rt);
  rt.listeners.clear();
  runtimes.delete(botId);
  store.removeBotFiles(botId);
}

function resetStatusesOnBoot() {
  db.run("UPDATE bots SET status = 'stopped' WHERE status != 'stopped'");
}

async function shutdownAll() {
  const ids = [...runtimes.keys()];
  await Promise.all(ids.map((id) => stopBot(id).catch(() => {})));
}

function runnerInfo() {
  return runner.info();
}

module.exports = {
  startBot,
  stopBot,
  restartBot,
  install,
  deleteBot,
  describe,
  getLogs,
  subscribe,
  systemLog,
  resetStatusesOnBoot,
  shutdownAll,
  runnerInfo
};
