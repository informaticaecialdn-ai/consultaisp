// Tool: ads_activate_campaign / ads_pause_campaign / ads_adjust_budget
// 3 tools relacionadas de controle de campanhas Meta/Google Ads.

const metaAds = require('../services/meta-ads');
const googleAds = require('../services/google-ads');
const { getDb } = require('../models/database');
const logger = require('../utils/logger');

async function applyStatus(campaign, newStatus) {
  if (!campaign.external_id) throw new Error('campanha sem external_id');
  if (campaign.platform === 'meta') {
    if (!metaAds.initialized) metaAds.init();
    await metaAds.updateCampaign(campaign.external_id, { status: newStatus.toUpperCase() });
  } else if (campaign.platform === 'google') {
    if (!googleAds.initialized) googleAds.init();
    await googleAds.updateCampaign(campaign.external_id, { status: newStatus.toUpperCase() });
  }
}

async function applyBudget(campaign, newDailyBudgetBrl) {
  if (!campaign.external_id) throw new Error('campanha sem external_id');
  if (campaign.platform === 'meta') {
    if (!metaAds.initialized) metaAds.init();
    await metaAds.updateCampaign(campaign.external_id, {
      daily_budget: Math.round(newDailyBudgetBrl * 100)
    });
  } else if (campaign.platform === 'google') {
    if (!googleAds.initialized) googleAds.init();
    await googleAds.updateCampaign(campaign.external_id, {
      daily_budget_micros: Math.round(newDailyBudgetBrl * 1_000_000)
    });
  }
}

function logDecision(campaignId, action, reason, valorNovo = null, metrics = null) {
  const db = getDb();
  db.prepare(
    `INSERT INTO ads_decisions (ads_campaign_id, action, reason, valor_novo, metrics_snapshot)
     VALUES (?, ?, ?, ?, ?)`
  ).run(
    campaignId,
    action,
    reason || null,
    valorNovo ? String(valorNovo) : null,
    metrics ? JSON.stringify(metrics) : null
  );
}

const activate = {
  name: 'ads_activate_campaign',
  description:
    'Ativa campanha pausada. So faca APOS revisar: mesorregiao correta, budget adequado, creativos com copy do Leo, targeting especifico. NAO ative campanhas com budget default.',
  input_schema: {
    type: 'object',
    properties: {
      campaign_db_id: { type: 'integer' },
      reason: { type: 'string', description: 'Justificativa pra ativar (ex: "Leo entregou copy, setup revisado")' }
    },
    required: ['campaign_db_id']
  },
  async handler(input) {
    const db = getDb();
    const c = db.prepare('SELECT * FROM ads_campaigns WHERE id = ?').get(input.campaign_db_id);
    if (!c) return { ok: false, error: 'campanha nao encontrada' };
    try {
      await applyStatus(c, 'ACTIVE');
      db.prepare(`UPDATE ads_campaigns SET status = 'active', atualizada_em = CURRENT_TIMESTAMP WHERE id = ?`).run(c.id);
      logDecision(c.id, 'activate', input.reason || 'ativada');
      logger.info({ campaign_db_id: c.id, platform: c.platform }, '[TOOL ads_activate_campaign]');
      return { ok: true, campaign_db_id: c.id, status: 'active' };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  }
};

const pause = {
  name: 'ads_pause_campaign',
  description:
    'Pausa campanha ativa. Use quando CPL > 2x meta, CTR < 0.5%, sem leads apos X spend, ou auto-healer acionado.',
  input_schema: {
    type: 'object',
    properties: {
      campaign_db_id: { type: 'integer' },
      reason: { type: 'string', description: 'Motivo curto (ex: "CPL R$180 > meta R$60", "CTR 0.3% < 0.5%")' },
      metrics_snapshot: {
        type: 'object',
        description: 'Opcional. Metricas no momento (CPL, CTR, spend, leads). Fica no log pra analise.'
      }
    },
    required: ['campaign_db_id', 'reason']
  },
  async handler(input) {
    const db = getDb();
    const c = db.prepare('SELECT * FROM ads_campaigns WHERE id = ?').get(input.campaign_db_id);
    if (!c) return { ok: false, error: 'campanha nao encontrada' };
    try {
      await applyStatus(c, 'PAUSED');
      db.prepare(`UPDATE ads_campaigns SET status = 'paused', atualizada_em = CURRENT_TIMESTAMP WHERE id = ?`).run(c.id);
      logDecision(c.id, 'pause', input.reason, null, input.metrics_snapshot);
      logger.info({ campaign_db_id: c.id, reason: input.reason }, '[TOOL ads_pause_campaign]');
      return { ok: true, campaign_db_id: c.id, status: 'paused', reason: input.reason };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  }
};

const adjustBudget = {
  name: 'ads_adjust_budget',
  description:
    'Ajusta orcamento diario de campanha. Escalar winners (ROAS>=2, CPL baixo): +25-50%. Cortar loser (CPL alto): -30%. Limites: min R$10/dia, max R$500/dia (hard guardrail).',
  input_schema: {
    type: 'object',
    properties: {
      campaign_db_id: { type: 'integer' },
      new_daily_budget_brl: { type: 'number', description: 'Novo budget. Min 10, max 500.' },
      reason: { type: 'string', description: 'Motivo (ex: "CPL R$35 abaixo meta, escalar +40%")' }
    },
    required: ['campaign_db_id', 'new_daily_budget_brl', 'reason']
  },
  async handler(input) {
    const db = getDb();
    const c = db.prepare('SELECT * FROM ads_campaigns WHERE id = ?').get(input.campaign_db_id);
    if (!c) return { ok: false, error: 'campanha nao encontrada' };
    const budget = Math.max(10, Math.min(500, Number(input.new_daily_budget_brl)));
    try {
      await applyBudget(c, budget);
      db.prepare(
        `UPDATE ads_campaigns SET budget_daily_brl = ?, atualizada_em = CURRENT_TIMESTAMP WHERE id = ?`
      ).run(budget, c.id);
      logDecision(c.id, 'adjust_budget', input.reason, `R$${budget}/dia (antes R$${c.budget_daily_brl})`);
      logger.info(
        { campaign_db_id: c.id, from: c.budget_daily_brl, to: budget, reason: input.reason },
        '[TOOL ads_adjust_budget]'
      );
      return { ok: true, campaign_db_id: c.id, previous_budget: c.budget_daily_brl, new_budget: budget };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  }
};

module.exports = { activate, pause, adjustBudget };
