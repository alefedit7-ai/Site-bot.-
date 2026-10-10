'use strict';

const express = require('express');
const config = require('../config');
const db = require('../database/db');
const asyncHandler = require('../utils/asyncHandler');
const secretBox = require('../auth/secretBox');
const manager = require('../services/botManager');
const store = require('../services/projectStore');
const plans = require('../services/plans');
const security = require('../middleware/security');
const { requireAuth } = require('../middleware/auth');
const {
  validateName,
  validateEntryFile,
  validateBotToken,
  validateEnvVars,
  parseId
} = require('../utils/validators');
const { AppError, badRequest, notFound, conflict } = require('../utils/errors');

const router = express.Router();
router.use(requireAuth);

const BOT_COLUMNS =
  'id, user_id, name, entry_file, token_enc, env_enc, auto_restart, has_project, last_started_at, created_at, updated_at';

// Sempre filtra por dono: um usuario nunca enxerga bots de outro (responde 404, nao 403).
function ownBot(req) {
  const id = parseId(req.params.id);
  const bot = db.get('SELECT ' + BOT_COLUMNS + ' FROM bots WHERE id = ? AND user_id = ?', [id, req.user.id]);
  if (!bot) throw notFound('Bot nao encontrado.');
  return bot;
}

function readEnv(bot) {
  if (!bot.env_enc) return {};
  try {
    return JSON.parse(secretBox.decrypt(bot.env_enc));
  } catch (e) {
    return {};
  }
}

// Nunca devolve token nem valores de variaveis: so se existem e quais nomes foram definidos.
function publicBot(bot) {
  const runtime = manager.describe(bot.id);
  return {
    id: bot.id,
    name: bot.name,
    entryFile: bot.entry_file,
    hasToken: !!bot.token_enc,
    hasProject: !!bot.has_project,
    autoRestart: !!bot.auto_restart,
    envKeys: Object.keys(readEnv(bot)).sort(),
    createdAt: bot.created_at,
    lastStartedAt: bot.last_started_at,
    status: runtime.status,
    uptimeSeconds: runtime.uptimeSeconds,
    memoryMb: runtime.memoryMb,
    cpuPercent: runtime.cpuPercent
  };
}

function reload(id) {
  return db.get('SELECT ' + BOT_COLUMNS + ' FROM bots WHERE id = ?', [id]);
}

router.get('/', (req, res) => {
  const rows = db.all('SELECT ' + BOT_COLUMNS + ' FROM bots WHERE user_id = ? ORDER BY id DESC', [req.user.id]);
  res.json({ bots: rows.map(publicBot) });
});

router.post(
  '/',
  security.actionLimiter,
  asyncHandler(async (req, res) => {
    const name = validateName((req.body || {}).name);
    const plan = plans.getPlan(req.user.plan);
    const count = db.get('SELECT COUNT(*) AS n FROM bots WHERE user_id = ?', [req.user.id]).n;
    if (count >= plan.maxBots) {
      throw badRequest('O plano ' + plan.label + ' permite ate ' + plan.maxBots + ' bots. Exclua um bot para criar outro.', 'limite_do_plano');
    }
    const now = Date.now();
    const result = db.run(
      "INSERT INTO bots (user_id, name, status, entry_file, auto_restart, has_project, created_at, updated_at) VALUES (?, ?, 'stopped', 'index.js', 0, 0, ?, ?)",
      [req.user.id, name, now, now]
    );
    res.status(201).json({ bot: publicBot(reload(Number(result.lastInsertRowid))) });
  })
);

router.get('/:id', (req, res) => {
  res.json({ bot: publicBot(ownBot(req)) });
});

router.patch(
  '/:id/settings',
  security.actionLimiter,
  asyncHandler(async (req, res) => {
    const bot = ownBot(req);
    const body = req.body || {};
    const changes = [];
    const params = [];
    let restartRequired = false;

    if (body.name !== undefined) {
      changes.push('name = ?');
      params.push(validateName(body.name));
    }
    if (body.entryFile !== undefined) {
      changes.push('entry_file = ?');
      params.push(validateEntryFile(body.entryFile));
      restartRequired = true;
    }
    if (body.autoRestart !== undefined) {
      if (typeof body.autoRestart !== 'boolean') throw badRequest('O campo autoRestart deve ser verdadeiro ou falso.');
      changes.push('auto_restart = ?');
      params.push(body.autoRestart ? 1 : 0);
    }
    if (body.clearToken === true) {
      changes.push('token_enc = ?');
      params.push(null);
      restartRequired = true;
    } else if (body.token !== undefined && body.token !== '') {
      changes.push('token_enc = ?');
      params.push(secretBox.encrypt(validateBotToken(body.token)));
      restartRequired = true;
    }
    if (body.envSet !== undefined || body.envRemove !== undefined) {
      const env = readEnv(bot);
      const toSet = validateEnvVars(body.envSet);
      Object.assign(env, toSet);
      if (body.envRemove !== undefined) {
        if (!Array.isArray(body.envRemove)) throw badRequest('envRemove deve ser uma lista de nomes.');
        for (const key of body.envRemove) {
          if (typeof key === 'string') delete env[key];
        }
      }
      validateEnvVars(env);
      changes.push('env_enc = ?');
      params.push(Object.keys(env).length ? secretBox.encrypt(JSON.stringify(env)) : null);
      restartRequired = true;
    }

    if (changes.length === 0) throw badRequest('Nenhuma alteracao foi enviada.');
    changes.push('updated_at = ?');
    params.push(Date.now());
    params.push(bot.id, req.user.id);
    db.run('UPDATE bots SET ' + changes.join(', ') + ' WHERE id = ? AND user_id = ?', params);

    const status = manager.describe(bot.id).status;
    const live = status === 'running' || status === 'starting';
    res.json({ bot: publicBot(reload(bot.id)), restartRequired: restartRequired && live });
  })
);

router.delete(
  '/:id',
  security.actionLimiter,
  asyncHandler(async (req, res) => {
    const bot = ownBot(req);
    await manager.deleteBot(bot.id);
    db.run('DELETE FROM bots WHERE id = ? AND user_id = ?', [bot.id, req.user.id]);
    res.json({ ok: true });
  })
);

// Upload: o navegador envia o ZIP como corpo binario (sem multipart).
function checkUploadSize(req, res, next) {
  const plan = plans.getPlan(req.user.plan);
  const limit = Math.min(config.uploadMaxBytes, plan.uploadMaxMb * 1048576);
  const declared = Number(req.headers['content-length']);
  if (Number.isFinite(declared) && declared > limit) {
    return next(new AppError(413, 'O ZIP passa do limite de ' + Math.floor(limit / 1048576) + ' MB do seu plano.', 'arquivo_grande'));
  }
  req.uploadLimit = limit;
  next();
}

router.post(
  '/:id/upload',
  (req, res, next) => {
    try {
      req.bot = ownBot(req);
      next();
    } catch (err) {
      next(err);
    }
  },
  security.uploadLimiter,
  checkUploadSize,
  express.raw({ type: () => true, limit: config.uploadMaxBytes }),
  asyncHandler(async (req, res) => {
    const bot = req.bot;
    const state = manager.describe(bot.id).status;
    if (state !== 'stopped' && state !== 'crashed') {
      throw conflict('Pare o bot antes de enviar um novo ZIP.');
    }
    const body = req.body;
    if (!Buffer.isBuffer(body) || body.length === 0) throw badRequest('Nenhum arquivo foi recebido.');
    if (body.length > req.uploadLimit) {
      throw new AppError(413, 'O ZIP passa do limite de ' + Math.floor(req.uploadLimit / 1048576) + ' MB do seu plano.', 'arquivo_grande');
    }
    if (body.readUInt32LE(0) !== 0x04034b50 && body.readUInt32LE(0) !== 0x06054b50) {
      throw badRequest('O arquivo enviado nao parece ser um ZIP.');
    }

    const plan = plans.getPlan(req.user.plan);
    const result = store.installZip(bot.id, body, { diskMb: plan.diskMb });
    db.run('UPDATE bots SET entry_file = ?, has_project = 1, updated_at = ? WHERE id = ?', [result.entryFile, Date.now(), bot.id]);
    manager.systemLog(bot.id, 'ZIP recebido: ' + result.fileCount + ' arquivos, arquivo principal ' + result.entryFile + '.');

    let installStarted = false;
    if (result.needsInstall) {
      manager.install(bot.id);
      installStarted = true;
    }
    res.json({
      bot: publicBot(reload(bot.id)),
      upload: { files: result.fileCount, sizeBytes: result.sizeBytes, entryFile: result.entryFile, installStarted }
    });
  })
);

router.post(
  '/:id/install',
  security.actionLimiter,
  asyncHandler(async (req, res) => {
    const bot = ownBot(req);
    manager.install(bot.id);
    res.status(202).json({ bot: publicBot(reload(bot.id)) });
  })
);

router.post(
  '/:id/start',
  security.actionLimiter,
  asyncHandler(async (req, res) => {
    const bot = ownBot(req);
    manager.startBot(bot.id);
    res.json({ bot: publicBot(reload(bot.id)) });
  })
);

router.post(
  '/:id/stop',
  security.actionLimiter,
  asyncHandler(async (req, res) => {
    const bot = ownBot(req);
    await manager.stopBot(bot.id);
    res.json({ bot: publicBot(reload(bot.id)) });
  })
);

router.post(
  '/:id/restart',
  security.actionLimiter,
  asyncHandler(async (req, res) => {
    const bot = ownBot(req);
    await manager.restartBot(bot.id);
    res.json({ bot: publicBot(reload(bot.id)) });
  })
);

router.get('/:id/logs', (req, res) => {
  const bot = ownBot(req);
  const after = parseInt(req.query.after, 10);
  res.json({ logs: manager.getLogs(bot.id, Number.isNaN(after) ? 0 : after), status: manager.describe(bot.id) });
});

// Console em tempo real via Server-Sent Events (SSE).
const streamsPerUser = new Map();
const MAX_STREAMS_PER_USER = 8;

router.get('/:id/logs/stream', (req, res) => {
  const bot = ownBot(req);
  const userId = req.user.id;
  const open = streamsPerUser.get(userId) || 0;
  if (open >= MAX_STREAMS_PER_USER) throw new AppError(429, 'Muitas abas de console abertas. Feche algumas e tente de novo.', 'limite_excedido');
  streamsPerUser.set(userId, open + 1);

  res.status(200).set({
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no'
  });
  res.flushHeaders();

  const send = (event, data, id) => {
    let chunk = '';
    if (id !== undefined) chunk += 'id: ' + id + '\n';
    chunk += 'event: ' + event + '\ndata: ' + JSON.stringify(data) + '\n\n';
    res.write(chunk);
  };

  const lastId = parseInt(req.get('last-event-id'), 10);
  const backlog = manager.getLogs(bot.id, Number.isNaN(lastId) ? 0 : lastId);
  for (const entry of backlog.slice(-300)) send('log', entry, entry.id);
  send('status', manager.describe(bot.id));

  const unsubscribe = manager.subscribe(bot.id, (event) => {
    if (event.type === 'log') send('log', event.data, event.data.id);
    else send('status', event.data);
  });
  const heartbeat = setInterval(() => res.write(': ping\n\n'), 20000);
  const statusTimer = setInterval(() => send('status', manager.describe(bot.id)), 5000);

  let closed = false;
  req.on('close', () => {
    if (closed) return;
    closed = true;
    clearInterval(heartbeat);
    clearInterval(statusTimer);
    unsubscribe();
    const now = (streamsPerUser.get(userId) || 1) - 1;
    if (now <= 0) streamsPerUser.delete(userId);
    else streamsPerUser.set(userId, now);
  });
});

module.exports = router;
