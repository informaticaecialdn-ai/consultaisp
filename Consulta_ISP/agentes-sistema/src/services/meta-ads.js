const bizSdk = require('facebook-nodejs-business-sdk');

class MetaAdsService {
  constructor() {
    this.initialized = false;
  }

  init() {
    if (this.initialized) return;

    const accessToken = process.env.META_ACCESS_TOKEN;
    const appId = process.env.META_APP_ID;
    const appSecret = process.env.META_APP_SECRET;

    if (!accessToken || !appId) {
      console.log('[META-ADS] Credenciais nao configuradas - servico desabilitado');
      return;
    }

    bizSdk.FacebookAdsApi.init(accessToken);
    this.api = bizSdk.FacebookAdsApi.getDefaultApi();
    this.api.setDebug(process.env.NODE_ENV !== 'production');

    this.accountId = process.env.META_AD_ACCOUNT_ID; // act_XXXXXXX
    this.pixelId = process.env.META_PIXEL_ID;
    this.pageId = process.env.META_PAGE_ID;
    this.account = new bizSdk.AdAccount(this.accountId);

    this.initialized = true;
    console.log('[META-ADS] Servico inicializado com sucesso');
  }

  // === CAMPANHAS ===

  async createCampaign({ name, objective, status = 'PAUSED', dailyBudget, lifetimeBudget, specialAdCategories = [] }) {
    this.init();

    const params = {
      [bizSdk.Campaign.Fields.name]: name,
      [bizSdk.Campaign.Fields.objective]: objective, // OUTCOME_LEADS, OUTCOME_TRAFFIC, OUTCOME_AWARENESS, OUTCOME_SALES
      [bizSdk.Campaign.Fields.status]: status, // ACTIVE, PAUSED
      [bizSdk.Campaign.Fields.special_ad_categories]: specialAdCategories,
    };

    if (dailyBudget) {
      params[bizSdk.Campaign.Fields.daily_budget] = Math.round(dailyBudget * 100); // centavos
    }
    if (lifetimeBudget) {
      params[bizSdk.Campaign.Fields.lifetime_budget] = Math.round(lifetimeBudget * 100);
    }

    try {
      const campaign = await this.account.createCampaign([], params);
      console.log(`[META-ADS] Campanha criada: ${name} (ID: ${campaign.id})`);
      return { success: true, campaign_id: campaign.id, name };
    } catch (error) {
      console.error('[META-ADS] Erro ao criar campanha:', error.message);
      throw error;
    }
  }

  async updateCampaign(campaignId, updates) {
    this.init();
    const campaign = new bizSdk.Campaign(campaignId);

    const params = {};
    if (updates.name) params[bizSdk.Campaign.Fields.name] = updates.name;
    if (updates.status) params[bizSdk.Campaign.Fields.status] = updates.status;
    if (updates.dailyBudget) params[bizSdk.Campaign.Fields.daily_budget] = Math.round(updates.dailyBudget * 100);

    try {
      await campaign.update(params);
      console.log(`[META-ADS] Campanha ${campaignId} atualizada`);
      return { success: true };
    } catch (error) {
      console.error('[META-ADS] Erro ao atualizar campanha:', error.message);
      throw error;
    }
  }

  // === AD SETS ===

  async createAdSet({ campaignId, name, dailyBudget, startTime, endTime, targeting, bidStrategy = 'LOWEST_COST_WITHOUT_CAP', billingEvent = 'IMPRESSIONS', optimizationGoal = 'LEAD_GENERATION', status = 'PAUSED' }) {
    this.init();

    const params = {
      [bizSdk.AdSet.Fields.name]: name,
      [bizSdk.AdSet.Fields.campaign_id]: campaignId,
      [bizSdk.AdSet.Fields.daily_budget]: Math.round(dailyBudget * 100),
      [bizSdk.AdSet.Fields.billing_event]: billingEvent,
      [bizSdk.AdSet.Fields.optimization_goal]: optimizationGoal,
      [bizSdk.AdSet.Fields.bid_strategy]: bidStrategy,
      [bizSdk.AdSet.Fields.targeting]: targeting,
      [bizSdk.AdSet.Fields.status]: status,
    };

    if (startTime) params[bizSdk.AdSet.Fields.start_time] = startTime;
    if (endTime) params[bizSdk.AdSet.Fields.end_time] = endTime;

    try {
      const adset = await this.account.createAdSet([], params);
      console.log(`[META-ADS] AdSet criado: ${name} (ID: ${adset.id})`);
      return { success: true, adset_id: adset.id, name };
    } catch (error) {
      console.error('[META-ADS] Erro ao criar AdSet:', error.message);
      throw error;
    }
  }

  async updateAdSet(adsetId, updates) {
    this.init();
    const adset = new bizSdk.AdSet(adsetId);

    const params = {};
    if (updates.name) params[bizSdk.AdSet.Fields.name] = updates.name;
    if (updates.status) params[bizSdk.AdSet.Fields.status] = updates.status;
    if (updates.dailyBudget) params[bizSdk.AdSet.Fields.daily_budget] = Math.round(updates.dailyBudget * 100);
    if (updates.targeting) params[bizSdk.AdSet.Fields.targeting] = updates.targeting;
    if (updates.bidAmount) params[bizSdk.AdSet.Fields.bid_amount] = Math.round(updates.bidAmount * 100);

    try {
      await adset.update(params);
      console.log(`[META-ADS] AdSet ${adsetId} atualizado`);
      return { success: true };
    } catch (error) {
      console.error('[META-ADS] Erro ao atualizar AdSet:', error.message);
      throw error;
    }
  }

  // === ANUNCIOS ===

  async createAd({ adsetId, name, creativeId, status = 'PAUSED' }) {
    this.init();

    const params = {
      [bizSdk.Ad.Fields.name]: name,
      [bizSdk.Ad.Fields.adset_id]: adsetId,
      [bizSdk.Ad.Fields.creative]: { creative_id: creativeId },
      [bizSdk.Ad.Fields.status]: status,
    };

    try {
      const ad = await this.account.createAd([], params);
      console.log(`[META-ADS] Anuncio criado: ${name} (ID: ${ad.id})`);
      return { success: true, ad_id: ad.id, name };
    } catch (error) {
      console.error('[META-ADS] Erro ao criar anuncio:', error.message);
      throw error;
    }
  }

  async createAdCreative({ name, pageId, message, headline, description, linkUrl, imageHash, imageUrl, callToAction = 'LEARN_MORE' }) {
    this.init();

    const objectStorySpec = {
      page_id: pageId || this.pageId,
      link_data: {
        message: message,
        link: linkUrl,
        name: headline,
        description: description,
        call_to_action: { type: callToAction },
      }
    };

    if (imageHash) {
      objectStorySpec.link_data.image_hash = imageHash;
    } else if (imageUrl) {
      objectStorySpec.link_data.picture = imageUrl;
    }

    const params = {
      [bizSdk.AdCreative.Fields.name]: name,
      [bizSdk.AdCreative.Fields.object_story_spec]: objectStorySpec,
    };

    try {
      const creative = await this.account.createAdCreative([], params);
      console.log(`[META-ADS] Criativo criado: ${name} (ID: ${creative.id})`);
      return { success: true, creative_id: creative.id, name };
    } catch (error) {
      console.error('[META-ADS] Erro ao criar criativo:', error.message);
      throw error;
    }
  }

  // === INSIGHTS / METRICAS ===

  async getCampaignInsights(campaignId, { datePreset = 'last_7d', fields } = {}) {
    this.init();
    const campaign = new bizSdk.Campaign(campaignId);

    const defaultFields = [
      'campaign_name', 'impressions', 'clicks', 'spend', 'reach',
      'cpc', 'cpm', 'ctr', 'cost_per_action_type', 'actions',
      'frequency', 'conversions', 'cost_per_conversion'
    ];

    try {
      const insights = await campaign.getInsights(
        fields || defaultFields,
        { date_preset: datePreset, time_increment: 1 }
      );
      return { success: true, data: insights.map(i => i._data) };
    } catch (error) {
      console.error('[META-ADS] Erro ao buscar insights:', error.message);
      throw error;
    }
  }

  async getAdSetInsights(adsetId, { datePreset = 'last_7d' } = {}) {
    this.init();
    const adset = new bizSdk.AdSet(adsetId);

    const fields = [
      'adset_name', 'impressions', 'clicks', 'spend', 'reach',
      'cpc', 'cpm', 'ctr', 'cost_per_action_type', 'actions',
      'frequency', 'conversions'
    ];

    try {
      const insights = await adset.getInsights(fields, { date_preset: datePreset });
      return { success: true, data: insights.map(i => i._data) };
    } catch (error) {
      console.error('[META-ADS] Erro ao buscar insights AdSet:', error.message);
      throw error;
    }
  }

  async getAccountInsights({ datePreset = 'last_30d' } = {}) {
    this.init();

    const fields = [
      'account_name', 'impressions', 'clicks', 'spend', 'reach',
      'cpc', 'cpm', 'ctr', 'cost_per_action_type', 'actions',
      'frequency', 'conversions', 'cost_per_conversion'
    ];

    try {
      const insights = await this.account.getInsights(fields, {
        date_preset: datePreset,
        time_increment: 1
      });
      return { success: true, data: insights.map(i => i._data) };
    } catch (error) {
      console.error('[META-ADS] Erro ao buscar insights da conta:', error.message);
      throw error;
    }
  }

  // === CAMPANHAS ATIVAS ===

  async listCampaigns({ status, limit = 50 } = {}) {
    this.init();

    const fields = [
      'name', 'status', 'objective', 'daily_budget', 'lifetime_budget',
      'created_time', 'updated_time', 'start_time', 'stop_time'
    ];

    const params = { limit };
    if (status) params.filtering = [{ field: 'effective_status', operator: 'IN', value: [status] }];

    try {
      const campaigns = await this.account.getCampaigns(fields, params);
      return { success: true, campaigns: campaigns.map(c => c._data) };
    } catch (error) {
      console.error('[META-ADS] Erro ao listar campanhas:', error.message);
      throw error;
    }
  }

  async listAdSets(campaignId, { limit = 50 } = {}) {
    this.init();
    const campaign = new bizSdk.Campaign(campaignId);

    const fields = [
      'name', 'status', 'daily_budget', 'targeting', 'optimization_goal',
      'bid_strategy', 'created_time'
    ];

    try {
      const adsets = await campaign.getAdSets(fields, { limit });
      return { success: true, adsets: adsets.map(a => a._data) };
    } catch (error) {
      console.error('[META-ADS] Erro ao listar AdSets:', error.message);
      throw error;
    }
  }

  // === PUBLICOS ===

  async createCustomAudience({ name, description, subtype = 'CUSTOM', customerFileSource }) {
    this.init();

    const params = {
      [bizSdk.CustomAudience.Fields.name]: name,
      [bizSdk.CustomAudience.Fields.description]: description,
      [bizSdk.CustomAudience.Fields.subtype]: subtype,
    };

    if (customerFileSource) {
      params[bizSdk.CustomAudience.Fields.customer_file_source] = customerFileSource;
    }

    try {
      const audience = await this.account.createCustomAudience([], params);
      console.log(`[META-ADS] Publico criado: ${name} (ID: ${audience.id})`);
      return { success: true, audience_id: audience.id, name };
    } catch (error) {
      console.error('[META-ADS] Erro ao criar publico:', error.message);
      throw error;
    }
  }

  async createLookalikeAudience({ name, sourceAudienceId, country = 'BR', ratio = 0.01 }) {
    this.init();

    const params = {
      [bizSdk.CustomAudience.Fields.name]: name,
      [bizSdk.CustomAudience.Fields.subtype]: 'LOOKALIKE',
      [bizSdk.CustomAudience.Fields.origin_audience_id]: sourceAudienceId,
      [bizSdk.CustomAudience.Fields.lookalike_spec]: JSON.stringify({
        country: country,
        ratio: ratio, // 0.01 = 1%
        type: 'similarity'
      }),
    };

    try {
      const audience = await this.account.createCustomAudience([], params);
      console.log(`[META-ADS] Lookalike criado: ${name} (ID: ${audience.id})`);
      return { success: true, audience_id: audience.id, name };
    } catch (error) {
      console.error('[META-ADS] Erro ao criar lookalike:', error.message);
      throw error;
    }
  }

  // Monta targeting para ISPs
  buildISPTargeting({ regions = [], ageMin = 25, ageMax = 60, genders = [1, 2] } = {}) {
    const targeting = {
      age_min: ageMin,
      age_max: ageMax,
      genders: genders,
      geo_locations: {
        countries: ['BR'],
      },
      interests: [
        { id: '6003107902433', name: 'Telecommunications' },
        { id: '6003384248805', name: 'Internet service provider' },
        { id: '6003573646219', name: 'Fiber-optic communication' },
      ],
      behaviors: [],
      publisher_platforms: ['facebook', 'instagram'],
      facebook_positions: ['feed', 'right_hand_column'],
      instagram_positions: ['stream', 'story', 'reels'],
    };

    if (regions.length > 0) {
      targeting.geo_locations.regions = regions.map(r => ({ key: r }));
    }

    return targeting;
  }
}

module.exports = new MetaAdsService();
