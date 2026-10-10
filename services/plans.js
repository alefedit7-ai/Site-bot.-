'use strict';

// Planos e limites. Para criar um plano novo, basta adicionar uma entrada aqui
// e gravar o nome dele na coluna users.plan. Nenhum outro arquivo precisa mudar.
const PLANS = {
  free: {
    id: 'free',
    label: 'Gratuito',
    maxBots: 2,
    maxRunningBots: 1,
    memoryMb: 256,
    diskMb: 100,
    uploadMaxMb: 10,
    installTimeoutSec: 300
  }
};

const DEFAULT_PLAN = 'free';

function getPlan(planId) {
  return PLANS[planId] || PLANS[DEFAULT_PLAN];
}

function listPlans() {
  return Object.values(PLANS);
}

module.exports = { PLANS, DEFAULT_PLAN, getPlan, listPlans };
