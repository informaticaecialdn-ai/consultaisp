// Tool: ads_get_performance
// Marcos puxa performance agregada de campanhas (impressions/clicks/leads/CPL/CTR).
// Pode ser uma campanha especifica (campaign_db_id) ou todas ativas.

const metaAds = require('../services/meta-ads');
const googleAds = require('../services/google-ads');
const { getDb } = require('../models/database');
const logger = require('../utils/logger');

module.exports = {
  name: 'ads_get_performance',
  description:
    'Busca performance de campanhas de midia paga nas ultimas 7-30 dias. Inclui CPL (custo por lead), CTR, spend, leads_gerados. Util pra Marcos decidir pausar (CPL alto) ou escalar (ROAS bom). Retorna array com metricas por campanha + resumo agregado.',
  input_schema: {
    type: 'object',
    properties: {
      campaign_db_id: {
        type: 'integer',
        description: 'Opcional. Se fornecido, pega so essa campanha. Se omitido, traz todas as ativas.'
      },
      platform: {
        type: 'string',
        enum: ['meta', 'google', 'all'],
        description: 'Filtra plataforma. Default: all.'
      },
      date_preset: {
        type: 'string',
        enum: ['last_7d', 'last_14d', 'last_30d'],
        description: 'Janela de analise. Default: last_7d.'
      }
    }
  },
  async handler(input) {
    const db = getDb();
    const preset = input.date_preset || 'last_7d';
    const where = ['1=1'];
    const params = [];
    if (input.campaign_db_id) {
      where.push('id = ?');
      params.push(input.campaign_db_id);
    } else {
      where.push("status IN ('active', 'paused')");
    }
    if (input.platform && input.platform !== 'all') {
      where.push('platform = ?');
      params.push(input.platform);
    }

    const campaigns = db
      .prepare(`SELECT * FROM ads_campaigns WHERE ${where.join(' AND ')}`)
      .all(...params);

    if (campaigns.length === 0) {
      return { ok: true, campaigns: [], resumo: { total: 0 }, note: 'Nenhuma campanha encontrada' };
    }

    const results = [];
    const resumo = { total: campaigns.length, spend_total: 0, leads_total: 0, impressions_total: 0, clicks_total: 0 };

    for (const c of campaigns) {
      if (!c.external_id) {
        results.push({
          ...pick(c, ['id', 'platform', 'name', 'mesorregiao_nome', 'status', 'budget_daily_brl']),
          error: 'sem external_id — campanha nao foi criada na plataforma'
        });
        continue;
      }

      try {
        let metrics = null;
        if (c.platform === 'meta') {
          if (!metaAds.initialized) metaAds.init();
          const insights = await metaAds.getCampaignInsights(c.external_id, { datePreset: preset });
          metrics = parseMetaInsights(insights);
        } else if (c.platform === 'google') {
          if (!googleAds.initialized) googleAds.init();
          const dates = datesFromPreset(preset);
          metrics = await googleAds.getCampaignMetrics({
            campaignId: c.external_id,
            dateFrom: dates.from,
            dateTo: dates.to
          });
        }

        // Conta leads reais no nosso DB que correlacionam com a mesorregiao
        // (proxy — Meta/Google Ads fornecem "leads" mas queremos contar os que
        // viraram lead no nosso DB)
        const leadsDb = db.prepare(
          `SELECT COUNT(*) AS c FROM leads
           WHERE mesorregiao = ?
             AND origem IN ('meta_ads','google_ads','outbound','whatsapp')
             AND criado_em >= DATETIME('now', ?)`
        ).get(c.mesorregiao, '-' + daysFromPreset(preset) + ' days');

        const leadsReais = leadsDb?.c || 0;
        const spend = metrics?.spend || 0;
        const impressions = metrics?.impressions || 0;
        const clicks = metrics?.clicks || 0;
        const cpl = leadsReais > 0 ? Number((spend / leadsReais).toFixed(2)) : null;
        const ctr = impressions > 0 ? Number((clicks / impressions * 100).toFixed(2)) : null;

        // Atualiza tabela local
        db.prepare(
          `UPDATE ads_campaigns SET
             impressions = ?, clicks = ?, leads_gerados = ?,
             spent_brl = ?, cpl_atual = ?, ctr_atual = ?,
             atualizada_em = CURRENT_TIMESTAMP
           WHERE id = ?`
        ).run(impressions, clicks, leadsReais, spend, cpl, ctr, c.id);

        const row = {
          campaign_db_id: c.id,
          platform: c.platform,
          name: c.name,
          mesorregiao_nome: c.mesorregiao_nome,
          status: c.status,
          budget_daily_brl: c.budget_daily_brl,
          date_preset: preset,
          metrics: {
            impressions, clicks, spend_brl: spend,
            leads_plataforma: metrics?.leads || 0,
            leads_reais: leadsReais,
            cpl_brl: cpl,
            ctr_pct: ctr
          }
        };
        results.push(row);

        resumo.spend_total += spend;
        resumo.leads_total += leadsReais;
        resumo.impressions_total += impressions;
        resumo.clicks_total += clicks;
      } catch (err) {
        results.push({
          campaign_db_id: c.id,
          platform: c.platform,
          name: c.name,
          error: err.message
        });
        logger.warn({ campaign_db_id: c.id, err: err.message }, '[TOOL ads_get_performance] falha');
      }
    }

    resumo.cpl_medio = resumo.leads_total > 0
      ? Number((resumo.spend_total / resumo.leads_total).toFixed(2))
      : null;
    resumo.ctr_medio = resumo.impressions_total > 0
      ? Number((resumo.clicks_total / resumo.impressions_total * 100).toFixed(2))
      : null;

    return { ok: true, campaigns: results, resumo, date_preset: preset };
  }
};

function pick(obj, keys) {
  const out = {};
  for (const k of keys) if (obj[k] !== undefined) out[k] = obj[k];
  return out;
}

function parseMetaInsights(insights) {
  if (!Array.isArray(insights) || insights.length === 0) return null;
  // Meta retorna array por dia — agrega
  const agg = { impressions: 0, clicks: 0, spend: 0, leads: 0 };
  for (const d of insights) {
    agg.impressions += Number(d.impressions || 0);
    agg.clicks += Number(d.clicks || 0);
    agg.spend += Number(d.spend || 0);
    if (d.actions) {
      const leadAction = d.actions.find((a) => a.action_type === 'lead' || a.action_type === 'onsite_conversion.lead_grouped');
      if (leadAction) agg.leads += parseInt(leadAction.value || 0);
    }
  }
  return agg;
}

function datesFromPreset(preset) {
  const now = new Date();
  const days = daysFromPreset(preset);
  const from = new Date(now.getTime() - days * 86400_000);
  const fmt = (d) => d.toISOString().slice(0, 10);
  return { from: fmt(from), to: fmt(now) };
}

function daysFromPreset(preset) {
  return preset === 'last_30d' ? 30 : preset === 'last_14d' ? 14 : 7;
}
