const express = require('express');
const router = express.Router();
const metaAds = require('../services/meta-ads');
const googleAds = require('../services/google-ads');
const adsOptimizer = require('../services/ads-optimizer');

// === META ADS ===

// Listar campanhas Meta
router.get('/meta/campaigns', async (req, res) => {
  try {
    const result = await metaAds.listCampaigns(req.query);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Criar campanha Meta
router.post('/meta/campaigns', async (req, res) => {
  try {
    const result = await metaAds.createCampaign(req.body);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Atualizar campanha Meta
router.put('/meta/campaigns/:id', async (req, res) => {
  try {
    const result = await metaAds.updateCampaign(req.params.id, req.body);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Criar AdSet Meta
router.post('/meta/adsets', async (req, res) => {
  try {
    const result = await metaAds.createAdSet(req.body);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Criar criativo + anuncio Meta
router.post('/meta/ads', async (req, res) => {
  try {
    const { creative, adsetId, name } = req.body;

    // 1. Criar criativo
    const creativeResult = await metaAds.createAdCreative(creative);

    // 2. Criar anuncio com o criativo
    const adResult = await metaAds.createAd({
      adsetId,
      name: name || creative.name,
      creativeId: creativeResult.creative_id,
    });

    res.json({ success: true, creative: creativeResult, ad: adResult });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Insights Meta - campanha
router.get('/meta/campaigns/:id/insights', async (req, res) => {
  try {
    const result = await metaAds.getCampaignInsights(req.params.id, req.query);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Insights Meta - conta completa
router.get('/meta/insights', async (req, res) => {
  try {
    const result = await metaAds.getAccountInsights(req.query);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Criar publico personalizado
router.post('/meta/audiences', async (req, res) => {
  try {
    const result = await metaAds.createCustomAudience(req.body);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Criar lookalike
router.post('/meta/audiences/lookalike', async (req, res) => {
  try {
    const result = await metaAds.createLookalikeAudience(req.body);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// === GOOGLE ADS ===

// Listar campanhas Google
router.get('/google/campaigns', async (req, res) => {
  try {
    const result = await googleAds.listCampaigns();
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Criar campanha Google
router.post('/google/campaigns', async (req, res) => {
  try {
    const result = await googleAds.createCampaign(req.body);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Atualizar campanha Google
router.put('/google/campaigns/:resourceName', async (req, res) => {
  try {
    const result = await googleAds.updateCampaign(req.params.resourceName, req.body);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Criar grupo de anuncios Google
router.post('/google/adgroups', async (req, res) => {
  try {
    const result = await googleAds.createAdGroup(req.body);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Adicionar keywords
router.post('/google/keywords', async (req, res) => {
  try {
    const { adGroupId, keywords } = req.body;
    const result = await googleAds.addKeywords(adGroupId, keywords);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Adicionar negativas
router.post('/google/keywords/negative', async (req, res) => {
  try {
    const { campaignId, keywords } = req.body;
    const result = await googleAds.addNegativeKeywords(campaignId, keywords);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Criar anuncio RSA Google
router.post('/google/ads', async (req, res) => {
  try {
    const result = await googleAds.createResponsiveSearchAd(req.body);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Metricas Google - campanhas
router.get('/google/metrics/campaigns', async (req, res) => {
  try {
    const result = await googleAds.getCampaignMetrics(req.query);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Metricas Google - ad groups
router.get('/google/metrics/adgroups', async (req, res) => {
  try {
    const result = await googleAds.getAdGroupMetrics(req.query);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Metricas Google - keywords
router.get('/google/metrics/keywords', async (req, res) => {
  try {
    const result = await googleAds.getKeywordMetrics(req.query);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Search terms Google
router.get('/google/searchterms', async (req, res) => {
  try {
    const result = await googleAds.getSearchTerms(req.query);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// === OTIMIZADOR IA ===

// Rodar otimizacao automatica
router.post('/optimize', async (req, res) => {
  try {
    const { platform } = req.body;
    let result = {};

    if (!platform || platform === 'meta') {
      result.meta = await adsOptimizer.analyzeAndOptimizeMeta();
    }
    if (!platform || platform === 'google') {
      result.google = await adsOptimizer.analyzeAndOptimizeGoogle();
    }

    res.json({ success: true, optimizations: result });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Analise IA das campanhas
router.get('/analysis', async (req, res) => {
  try {
    const result = await adsOptimizer.getAIAnalysis();
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Planejar campanha com IA
router.post('/plan', async (req, res) => {
  try {
    const result = await adsOptimizer.createCampaignWithAI(req.body);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Relatorio completo
router.get('/report', async (req, res) => {
  try {
    const result = await adsOptimizer.generateReport(req.query.period || 'last_7d');
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
