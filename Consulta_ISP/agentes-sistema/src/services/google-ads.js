const { GoogleAdsApi, enums } = require('google-ads-api');

class GoogleAdsService {
  constructor() {
    this.initialized = false;
  }

  init() {
    if (this.initialized) return;

    const clientId = process.env.GOOGLE_ADS_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_ADS_CLIENT_SECRET;
    const developerToken = process.env.GOOGLE_ADS_DEVELOPER_TOKEN;

    if (!clientId || !developerToken) {
      console.log('[GOOGLE-ADS] Credenciais nao configuradas - servico desabilitado');
      return;
    }

    this.client = new GoogleAdsApi({
      client_id: clientId,
      client_secret: clientSecret,
      developer_token: developerToken,
    });

    this.customerId = process.env.GOOGLE_ADS_CUSTOMER_ID;
    this.loginCustomerId = process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID;
    this.refreshToken = process.env.GOOGLE_ADS_REFRESH_TOKEN;

    this.customer = this.client.Customer({
      customer_id: this.customerId,
      login_customer_id: this.loginCustomerId,
      refresh_token: this.refreshToken,
    });

    this.initialized = true;
    console.log('[GOOGLE-ADS] Servico inicializado com sucesso');
  }

  // === CAMPANHAS ===

  async createCampaign({ name, type = 'SEARCH', status = 'PAUSED', dailyBudgetMicros, biddingStrategy = 'MAXIMIZE_CONVERSIONS' }) {
    this.init();

    try {
      // 1. Criar orcamento
      const budgetResult = await this.customer.campaignBudgets.create({
        campaign_budget: {
          name: `Budget - ${name}`,
          amount_micros: dailyBudgetMicros || 5000000, // R$5 default (em micros = * 1000000)
          delivery_method: enums.BudgetDeliveryMethod.STANDARD,
        }
      });

      const budgetResourceName = budgetResult.results[0].resource_name;

      // 2. Criar campanha
      const campaignParams = {
        campaign: {
          name: name,
          advertising_channel_type: enums.AdvertisingChannelType[type], // SEARCH, DISPLAY, PERFORMANCE_MAX
          status: enums.CampaignStatus[status],
          campaign_budget: budgetResourceName,
        }
      };

      // Configurar estrategia de lance
      switch (biddingStrategy) {
        case 'MAXIMIZE_CONVERSIONS':
          campaignParams.campaign.maximize_conversions = {};
          break;
        case 'TARGET_CPA':
          campaignParams.campaign.target_cpa = {
            target_cpa_micros: process.env.GOOGLE_ADS_TARGET_CPA_MICROS || 50000000 // R$50 default
          };
          break;
        case 'MAXIMIZE_CLICKS':
          campaignParams.campaign.maximize_clicks = {};
          break;
        case 'TARGET_ROAS':
          campaignParams.campaign.target_roas = {
            target_roas: 2.0 // 200% ROAS default
          };
          break;
      }

      const result = await this.customer.campaigns.create(campaignParams);
      const campaignResourceName = result.results[0].resource_name;
      const campaignId = campaignResourceName.split('/').pop();

      console.log(`[GOOGLE-ADS] Campanha criada: ${name} (ID: ${campaignId})`);
      return { success: true, campaign_id: campaignId, resource_name: campaignResourceName, name };
    } catch (error) {
      console.error('[GOOGLE-ADS] Erro ao criar campanha:', error.message);
      throw error;
    }
  }

  async updateCampaign(campaignResourceName, updates) {
    this.init();

    const campaignUpdate = { resource_name: campaignResourceName };
    if (updates.name) campaignUpdate.name = updates.name;
    if (updates.status) campaignUpdate.status = enums.CampaignStatus[updates.status];

    try {
      await this.customer.campaigns.update({ campaign: campaignUpdate });
      console.log(`[GOOGLE-ADS] Campanha atualizada: ${campaignResourceName}`);
      return { success: true };
    } catch (error) {
      console.error('[GOOGLE-ADS] Erro ao atualizar campanha:', error.message);
      throw error;
    }
  }

  // === GRUPOS DE ANUNCIOS ===

  async createAdGroup({ campaignId, name, cpcBidMicros = 2000000, status = 'PAUSED' }) {
    this.init();

    try {
      const result = await this.customer.adGroups.create({
        ad_group: {
          name: name,
          campaign: `customers/${this.customerId}/campaigns/${campaignId}`,
          status: enums.AdGroupStatus[status],
          cpc_bid_micros: cpcBidMicros, // R$2 default
          type: enums.AdGroupType.SEARCH_STANDARD,
        }
      });

      const resourceName = result.results[0].resource_name;
      const adGroupId = resourceName.split('/').pop();

      console.log(`[GOOGLE-ADS] Ad Group criado: ${name} (ID: ${adGroupId})`);
      return { success: true, ad_group_id: adGroupId, resource_name: resourceName, name };
    } catch (error) {
      console.error('[GOOGLE-ADS] Erro ao criar Ad Group:', error.message);
      throw error;
    }
  }

  // === PALAVRAS-CHAVE ===

  async addKeywords(adGroupId, keywords) {
    this.init();

    const operations = keywords.map(kw => ({
      ad_group_criterion: {
        ad_group: `customers/${this.customerId}/adGroups/${adGroupId}`,
        keyword: {
          text: kw.text,
          match_type: enums.KeywordMatchType[kw.matchType || 'PHRASE'], // EXACT, PHRASE, BROAD
        },
        status: enums.AdGroupCriterionStatus.ENABLED,
        ...(kw.cpcBidMicros ? { cpc_bid_micros: kw.cpcBidMicros } : {}),
      }
    }));

    try {
      const results = await this.customer.adGroupCriteria.create(operations);
      console.log(`[GOOGLE-ADS] ${keywords.length} keywords adicionadas ao AdGroup ${adGroupId}`);
      return { success: true, count: keywords.length };
    } catch (error) {
      console.error('[GOOGLE-ADS] Erro ao adicionar keywords:', error.message);
      throw error;
    }
  }

  async addNegativeKeywords(campaignId, keywords) {
    this.init();

    const operations = keywords.map(kw => ({
      campaign_criterion: {
        campaign: `customers/${this.customerId}/campaigns/${campaignId}`,
        keyword: {
          text: kw,
          match_type: enums.KeywordMatchType.BROAD,
        },
        negative: true,
      }
    }));

    try {
      await this.customer.campaignCriteria.create(operations);
      console.log(`[GOOGLE-ADS] ${keywords.length} negative keywords adicionadas`);
      return { success: true, count: keywords.length };
    } catch (error) {
      console.error('[GOOGLE-ADS] Erro ao adicionar negatives:', error.message);
      throw error;
    }
  }

  // === ANUNCIOS RESPONSIVOS DE PESQUISA ===

  async createResponsiveSearchAd({ adGroupId, headlines, descriptions, finalUrl, path1, path2 }) {
    this.init();

    try {
      const result = await this.customer.ads.create({
        ad_group_ad: {
          ad_group: `customers/${this.customerId}/adGroups/${adGroupId}`,
          status: enums.AdGroupAdStatus.PAUSED,
          ad: {
            responsive_search_ad: {
              headlines: headlines.map((h, i) => ({
                text: h,
                pinned_field: i === 0 ? enums.ServedAssetFieldType.HEADLINE_1 : undefined,
              })),
              descriptions: descriptions.map(d => ({ text: d })),
              path1: path1 || 'consulta',
              path2: path2 || 'isp',
            },
            final_urls: [finalUrl || 'https://consultaisp.com.br'],
          }
        }
      });

      console.log(`[GOOGLE-ADS] Anuncio RSA criado no AdGroup ${adGroupId}`);
      return { success: true, resource_name: result.results[0].resource_name };
    } catch (error) {
      console.error('[GOOGLE-ADS] Erro ao criar RSA:', error.message);
      throw error;
    }
  }

  // === METRICAS E RELATORIOS ===

  async getCampaignMetrics({ dateFrom, dateTo, campaignId } = {}) {
    this.init();

    const today = new Date().toISOString().split('T')[0].replace(/-/g, '');
    const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString().split('T')[0].replace(/-/g, '');

    let query = `
      SELECT
        campaign.id,
        campaign.name,
        campaign.status,
        metrics.impressions,
        metrics.clicks,
        metrics.cost_micros,
        metrics.ctr,
        metrics.average_cpc,
        metrics.conversions,
        metrics.cost_per_conversion,
        metrics.all_conversions,
        metrics.search_impression_share,
        segments.date
      FROM campaign
      WHERE segments.date BETWEEN '${dateFrom || weekAgo}' AND '${dateTo || today}'
    `;

    if (campaignId) {
      query += ` AND campaign.id = ${campaignId}`;
    }

    query += ' ORDER BY segments.date DESC';

    try {
      const results = await this.customer.query(query);
      const formatted = results.map(r => ({
        campaign_id: r.campaign.id,
        campaign_name: r.campaign.name,
        status: r.campaign.status,
        date: r.segments.date,
        impressions: r.metrics.impressions,
        clicks: r.metrics.clicks,
        cost: r.metrics.cost_micros / 1000000,
        ctr: r.metrics.ctr,
        avg_cpc: r.metrics.average_cpc / 1000000,
        conversions: r.metrics.conversions,
        cost_per_conversion: r.metrics.cost_per_conversion / 1000000,
        impression_share: r.metrics.search_impression_share,
      }));

      return { success: true, data: formatted };
    } catch (error) {
      console.error('[GOOGLE-ADS] Erro ao buscar metricas:', error.message);
      throw error;
    }
  }

  async getAdGroupMetrics({ dateFrom, dateTo, campaignId } = {}) {
    this.init();

    const today = new Date().toISOString().split('T')[0].replace(/-/g, '');
    const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString().split('T')[0].replace(/-/g, '');

    let query = `
      SELECT
        ad_group.id,
        ad_group.name,
        ad_group.status,
        campaign.name,
        metrics.impressions,
        metrics.clicks,
        metrics.cost_micros,
        metrics.ctr,
        metrics.average_cpc,
        metrics.conversions,
        metrics.cost_per_conversion
      FROM ad_group
      WHERE segments.date BETWEEN '${dateFrom || weekAgo}' AND '${dateTo || today}'
    `;

    if (campaignId) query += ` AND campaign.id = ${campaignId}`;
    query += ' ORDER BY metrics.cost_micros DESC';

    try {
      const results = await this.customer.query(query);
      return {
        success: true,
        data: results.map(r => ({
          ad_group_id: r.ad_group.id,
          ad_group_name: r.ad_group.name,
          campaign_name: r.campaign.name,
          impressions: r.metrics.impressions,
          clicks: r.metrics.clicks,
          cost: r.metrics.cost_micros / 1000000,
          ctr: r.metrics.ctr,
          avg_cpc: r.metrics.average_cpc / 1000000,
          conversions: r.metrics.conversions,
          cpl: r.metrics.cost_per_conversion / 1000000,
        }))
      };
    } catch (error) {
      console.error('[GOOGLE-ADS] Erro ao buscar metricas AdGroup:', error.message);
      throw error;
    }
  }

  async getKeywordMetrics({ adGroupId, dateFrom, dateTo } = {}) {
    this.init();

    const today = new Date().toISOString().split('T')[0].replace(/-/g, '');
    const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString().split('T')[0].replace(/-/g, '');

    let query = `
      SELECT
        ad_group_criterion.keyword.text,
        ad_group_criterion.keyword.match_type,
        ad_group_criterion.quality_info.quality_score,
        metrics.impressions,
        metrics.clicks,
        metrics.cost_micros,
        metrics.ctr,
        metrics.average_cpc,
        metrics.conversions
      FROM keyword_view
      WHERE segments.date BETWEEN '${dateFrom || weekAgo}' AND '${dateTo || today}'
    `;

    if (adGroupId) query += ` AND ad_group.id = ${adGroupId}`;
    query += ' ORDER BY metrics.impressions DESC LIMIT 100';

    try {
      const results = await this.customer.query(query);
      return {
        success: true,
        data: results.map(r => ({
          keyword: r.ad_group_criterion.keyword.text,
          match_type: r.ad_group_criterion.keyword.match_type,
          quality_score: r.ad_group_criterion.quality_info?.quality_score,
          impressions: r.metrics.impressions,
          clicks: r.metrics.clicks,
          cost: r.metrics.cost_micros / 1000000,
          ctr: r.metrics.ctr,
          avg_cpc: r.metrics.average_cpc / 1000000,
          conversions: r.metrics.conversions,
        }))
      };
    } catch (error) {
      console.error('[GOOGLE-ADS] Erro ao buscar metricas keywords:', error.message);
      throw error;
    }
  }

  // Listar campanhas
  async listCampaigns() {
    this.init();

    const query = `
      SELECT
        campaign.id,
        campaign.name,
        campaign.status,
        campaign.advertising_channel_type,
        campaign_budget.amount_micros
      FROM campaign
      WHERE campaign.status != 'REMOVED'
      ORDER BY campaign.id DESC
    `;

    try {
      const results = await this.customer.query(query);
      return {
        success: true,
        campaigns: results.map(r => ({
          id: r.campaign.id,
          name: r.campaign.name,
          status: r.campaign.status,
          type: r.campaign.advertising_channel_type,
          daily_budget: r.campaign_budget.amount_micros / 1000000,
        }))
      };
    } catch (error) {
      console.error('[GOOGLE-ADS] Erro ao listar campanhas:', error.message);
      throw error;
    }
  }

  // Termos de busca (para encontrar negatives)
  async getSearchTerms({ campaignId, dateFrom, dateTo } = {}) {
    this.init();

    const today = new Date().toISOString().split('T')[0].replace(/-/g, '');
    const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString().split('T')[0].replace(/-/g, '');

    let query = `
      SELECT
        search_term_view.search_term,
        metrics.impressions,
        metrics.clicks,
        metrics.cost_micros,
        metrics.conversions
      FROM search_term_view
      WHERE segments.date BETWEEN '${dateFrom || weekAgo}' AND '${dateTo || today}'
    `;

    if (campaignId) query += ` AND campaign.id = ${campaignId}`;
    query += ' ORDER BY metrics.cost_micros DESC LIMIT 200';

    try {
      const results = await this.customer.query(query);
      return {
        success: true,
        data: results.map(r => ({
          term: r.search_term_view.search_term,
          impressions: r.metrics.impressions,
          clicks: r.metrics.clicks,
          cost: r.metrics.cost_micros / 1000000,
          conversions: r.metrics.conversions,
        }))
      };
    } catch (error) {
      console.error('[GOOGLE-ADS] Erro ao buscar search terms:', error.message);
      throw error;
    }
  }
}

module.exports = new GoogleAdsService();
