'use strict';

const express = require('express');
const db = require('../database/db');
const plans = require('../services/plans');
const manager = require('../services/botManager');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

router.get('/health', (req, res) => {
  res.json({ ok: true, name: 'BotNexus' });
});

// Plano atual, limites e uso da conta.
router.get('/plan', requireAuth, (req, res) => {
  const plan = plans.getPlan(req.user.plan);
  const bots = db.get('SELECT COUNT(*) AS n FROM bots WHERE user_id = ?', [req.user.id]).n;
  const running = db.get("SELECT COUNT(*) AS n FROM bots WHERE user_id = ? AND status IN ('running','starting')", [req.user.id]).n;
  const info = manager.runnerInfo();
  res.json({
    plan: {
      id: plan.id,
      label: plan.label,
      maxBots: plan.maxBots,
      maxRunningBots: plan.maxRunningBots,
      memoryMb: plan.memoryMb,
      diskMb: plan.diskMb,
      uploadMaxMb: plan.uploadMaxMb
    },
    usage: { bots, running },
    isolation: { runner: info.runner, fileSandbox: info.fileSandbox, description: info.description }
  });
});

module.exports = router;
