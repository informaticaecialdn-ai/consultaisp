// Tool: ads_create_campaign
// Marcos cria campanha Meta Ads ou Google Ads com segmentacao regional.
// Registra em ads_campaigns pra tracking. Status inicial PAUSED — Marcos
// chama ads_activate depois de validar setup.

const metaAds = require('../services/meta-ads');
const googleAds = require('../services/google-ads');
const { getDb } = require('../models/database');
const logger = require('../utils/logger');

module.exports = {
  name: 'ads_create_campaign',
  description:
    'Cria campanha de midia paga (Meta Ads ou Google Ads) segmentada por mesorregiao. Comeca PAUSADA — Marcos revisa config antes de ativar via ads_activate_campaign. IMPORTANTE: segmentacao REGIONAL e obrigatoria (o produto so funciona com densidade regional — veja skill sofia-regional-playbook). Retorna { campaign_db_id, external_id, status }.',
  input_schema: {
    type: 'object',
    properties: {
      platform: { type: 'string', enum: ['meta', 'google'] },
      name: {
        type: 'string',
        description: 'Nome descritivo. Sugestao: "[Meso] - [Objetivo] - YYYY-MM". Ex: "Norte Central PR - Leads - 2026-04"'
      },
      objective: {
        type: 'string',
        description: 'Meta: OUTCOME_LEADS | OUTCOME_TRAFFIC | OUTCOME_AWARENESS. Google: SEARCH | PERFORMANCE_MAX. Default: OUTCOME_LEADS (Meta) ou SEARCH (Google).'
      },
      mesorregiao: {
        type: 'string',
        description: 'Slug IBGE da mesorregiao alvo (ex: "norte-central-paranaense"). Obrigatorio pra segmentacao regional correta.'
      },
      mesorregiao_nome: { type: 'string', description: 'Nome legivel da mesorregiao' },
      estado: { type: 'string', description: 'UF (2 letras)' },
      cidades: {
        type: 'array',
        items: { type: 'string' },
        description: 'Lista de cidades alvo dentro da mesorregiao (max 20). Meta: geo targeting por cidade. Google: location targeting.'
      },
      daily_budget_brl: {
        type: 'number',
        description: 'Orcamento diario em R$. Sugestao inicial: R$30-50/dia pra teste, R$100-300 em snowball.'
      },
      headlines: {
        type: 'array',
        items: { type: 'string' },
        description: 'Google Ads: 3-5 headlines (max 30 chars cada). Meta: primeiro vira headline do ad.'
      },
      descriptions: {
        type: 'array',
        items: { type: 'string' },
        description: 'Google Ads: 2-4 descriptions (max 90 chars). Meta: primeiro vira body do ad.'
      },
      keywords: {
        type: 'array',
        items: { type: 'string' },
        description: 'Google Ads only. Palavras-chave (match broad). Ex: ["provedor inadimplencia","base credito isp","bureau provedor"]'
      },
      landing_url: { type: 'string', description: 'URL de destino (landing page ou homepage)' }
    },
    required: ['platform', 'name', 'mesorregiao', 'daily_budget_brl']
  },
  async handler(input, ctx = {}) {
    const db = getDb();

    // Insere registro local PRIMEIRO (pra ter id mesmo se API falhar)
    const insertResult = db.prepare(
      `INSERT INTO ads_campaigns
       (platform, name, objective, status, mesorregiao, mesorregiao_nome, estado,
        cidades, budget_daily_brl, criada_por_agente, raw_metadata)
       VALUES (?, ?, ?, 'draft', ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      input.platform,
      input.name,
      input.objective || (input.platform === 'meta' ? 'OUTCOME_LEADS' : 'SEARCH'),
      input.mesorregiao || null,
      input.mesorregiao_nome || null,
      input.estado || null,
      JSON.stringify(input.cidades || []),
      Number(input.daily_budget_brl) || 0,
      ctx.agente || 'marcos',
      JSON.stringify(input)
    );
    const campaignDbId = insertResult.lastInsertRowid;

    // Tenta criar na plataforma
    try {
      let externalId = null;

      if (input.platform === 'meta') {
        if (!metaAds.initialized) metaAds.init();
        if (!process.env.META_ACCESS_TOKEN) {
          throw new Error('META_ACCESS_TOKEN nao configurado');
        }
        const result = await metaAds.createCampaign({
          name: input.name,
          objective: input.objective || 'OUTCOME_LEADS',
          status: 'PAUSED',
          dailyBudget: input.daily_budget_brl
        });
        externalId = result?.campaign_id;
      } else if (input.platform === 'google') {
        if (!googleAds.initialized) googleAds.init();
        if (!process.env.GOOGLE_ADS_CUSTOMER_ID) {
          throw new Error('GOOGLE_ADS_CUSTOMER_ID nao configurado');
        }
        const result = await googleAds.createCampaign({
          name: input.name,
          type: input.objective || 'SEARCH',
          status: 'PAUSED',
          dailyBudgetMicros: Math.round((input.daily_budget_brl || 30) * 1_000_000)
        });
        externalId = result?.campaign_resource_name || result?.id;
      }

      db.prepare(
        `UPDATE ads_campaigns SET
           external_id = ?, status = 'paused', atualizada_em = CURRENT_TIMESTAMP
         WHERE id = ?`
      ).run(externalId, campaignDbId);

      db.prepare(
        `INSERT INTO ads_decisions (ads_campaign_id, action, reason, valor_novo)
         VALUES (?, 'create', ?, ?)`
      ).run(campaignDbId, `criada pausada: ${input.name}`, `R$${input.daily_budget_brl}/dia`);

      logger.info(
        { campaign_db_id: campaignDbId, external_id: externalId, platform: input.platform },
        '[TOOL ads_create_campaign] campanha criada (paused)'
      );

      return {
        ok: true,
        campaign_db_id: campaignDbId,
        external_id: externalId,
        platform: input.platform,
        status: 'paused',
        note: 'Campanha criada PAUSADA. Revise targeting e chame ads_activate_campaign pra ativar.'
      };
    } catch (err) {
      db.prepare(
        `UPDATE ads_campaigns SET status = 'error', observacoes = ?, atualizada_em = CURRENT_TIMESTAMP WHERE id = ?`
      ).run(err.message.slice(0, 300), campaignDbId);

      logger.error(
        { campaign_db_id: campaignDbId, err: err.message, platform: input.platform },
        '[TOOL ads_create_campaign] falha'
      );

      return {
        ok: false,
        campaign_db_id: campaignDbId,
        error: err.message,
        note: 'Registro local criado mas falhou na API. Veja ads_campaigns id acima pra retry.'
      };
    }
  }
};
