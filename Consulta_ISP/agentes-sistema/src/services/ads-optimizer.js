const metaAds = require('./meta-ads');
const googleAds = require('./google-ads');
const claude = require('./claude');
const { getDb } = require('../models/database');

class AdsOptimizer {

  // === OTIMIZACAO AUTOMATICA META ADS ===

  async analyzeAndOptimizeMeta() {
    const db = getDb();
    const acoes = [];

    try {
      // Buscar todas as campanhas ativas
      const { campaigns } = await metaAds.listCampaigns({ status: 'ACTIVE' });

      for (const campaign of campaigns) {
        const { data: insights } = await metaAds.getCampaignInsights(campaign.id, { datePreset: 'last_3d' });

        if (!insights || insights.length === 0) continue;

        // Agregar metricas dos ultimos 3 dias
        const aggregated = this._aggregateMetaInsights(insights);

        // Aplicar regras de otimizacao
        const optimizations = this._applyMetaRules(campaign, aggregated);

        for (const opt of optimizations) {
          acoes.push(opt);

          // Executar a otimizacao
          if (opt.action === 'pause_adset' && opt.adsetId) {
            await metaAds.updateAdSet(opt.adsetId, { status: 'PAUSED' });
          } else if (opt.action === 'pause_campaign') {
            await metaAds.updateCampaign(campaign.id, { status: 'PAUSED' });
          } else if (opt.action === 'increase_budget' && opt.newBudget) {
            await metaAds.updateCampaign(campaign.id, { dailyBudget: opt.newBudget });
          } else if (opt.action === 'decrease_budget' && opt.newBudget) {
            await metaAds.updateCampaign(campaign.id, { dailyBudget: opt.newBudget });
          }

          // Registrar atividade
          this._logAdsActivity('marcos', 'otimizacao_meta', `${opt.reason} - Campanha: ${campaign.name}`, opt.action);
        }
      }
    } catch (error) {
      console.error('[ADS-OPTIMIZER] Erro na otimizacao Meta:', error.message);
    }

    return acoes;
  }

  _aggregateMetaInsights(insights) {
    let totalSpend = 0, totalClicks = 0, totalImpressions = 0, totalLeads = 0;

    for (const day of insights) {
      totalSpend += parseFloat(day.spend || 0);
      totalClicks += parseInt(day.clicks || 0);
      totalImpressions += parseInt(day.impressions || 0);

      if (day.actions) {
        const leadAction = day.actions.find(a => a.action_type === 'lead' || a.action_type === 'onsite_conversion.messaging_first_reply');
        if (leadAction) totalLeads += parseInt(leadAction.value || 0);
      }
    }

    return {
      spend: totalSpend,
      clicks: totalClicks,
      impressions: totalImpressions,
      leads: totalLeads,
      cpc: totalClicks > 0 ? totalSpend / totalClicks : 0,
      ctr: totalImpressions > 0 ? (totalClicks / totalImpressions * 100) : 0,
      cpl: totalLeads > 0 ? totalSpend / totalLeads : 0,
      cpm: totalImpressions > 0 ? (totalSpend / totalImpressions * 1000) : 0,
      frequency: parseFloat(insights[insights.length - 1]?.frequency || 0),
      days: insights.length,
    };
  }

  _applyMetaRules(campaign, metrics) {
    const rules = [];
    const cplMeta = parseFloat(process.env.ADS_CPL_META_TARGET || 50); // R$50 default
    const currentBudget = (campaign.daily_budget || 0) / 100; // centavos para reais

    // Regra 1: CPL muito alto por 3+ dias -> pausar
    if (metrics.cpl > cplMeta * 2 && metrics.days >= 3 && metrics.leads > 0) {
      rules.push({
        action: 'pause_campaign',
        reason: `CPL R$${metrics.cpl.toFixed(2)} esta ${(metrics.cpl / cplMeta * 100).toFixed(0)}% acima da meta de R$${cplMeta}`,
        severity: 'alta',
        metrics: { cpl: metrics.cpl, meta: cplMeta }
      });
    }

    // Regra 2: CTR muito baixo -> alerta para trocar criativo
    if (metrics.ctr < 0.5 && metrics.impressions > 1000) {
      rules.push({
        action: 'alert_creative',
        reason: `CTR ${metrics.ctr.toFixed(2)}% muito baixo (meta >1%). Trocar criativo ou publico`,
        severity: 'media',
        metrics: { ctr: metrics.ctr }
      });
    }

    // Regra 3: Frequencia alta -> fadiga de anuncio
    if (metrics.frequency > 4) {
      rules.push({
        action: 'alert_fatigue',
        reason: `Frequencia ${metrics.frequency.toFixed(1)} alta (max 4). Renovar criativo ou expandir publico`,
        severity: 'media',
        metrics: { frequency: metrics.frequency }
      });
    }

    // Regra 4: Performance excelente -> escalar
    if (metrics.cpl > 0 && metrics.cpl < cplMeta * 0.7 && metrics.leads >= 3) {
      const newBudget = currentBudget * 1.3; // +30%
      rules.push({
        action: 'increase_budget',
        reason: `CPL R$${metrics.cpl.toFixed(2)} excelente (${(metrics.cpl / cplMeta * 100).toFixed(0)}% da meta). Escalando budget +30%`,
        severity: 'positiva',
        newBudget: newBudget,
        metrics: { cpl: metrics.cpl, budget_anterior: currentBudget, budget_novo: newBudget }
      });
    }

    // Regra 5: Sem conversoes e gasto alto
    if (metrics.leads === 0 && metrics.spend > cplMeta * 3) {
      rules.push({
        action: 'pause_campaign',
        reason: `R$${metrics.spend.toFixed(2)} gastos sem nenhum lead. Pausando para revisao`,
        severity: 'critica',
        metrics: { spend: metrics.spend, leads: 0 }
      });
    }

    return rules;
  }

  // === OTIMIZACAO AUTOMATICA GOOGLE ADS ===

  async analyzeAndOptimizeGoogle() {
    const acoes = [];

    try {
      const { campaigns } = await googleAds.listCampaigns();
      const activeCampaigns = campaigns.filter(c => c.status === 'ENABLED');

      for (const campaign of activeCampaigns) {
        const { data: metrics } = await googleAds.getCampaignMetrics({ campaignId: campaign.id });

        if (!metrics || metrics.length === 0) continue;

        const aggregated = this._aggregateGoogleMetrics(metrics);
        const optimizations = this._applyGoogleRules(campaign, aggregated);

        for (const opt of optimizations) {
          acoes.push(opt);

          if (opt.action === 'pause_campaign') {
            await googleAds.updateCampaign(
              `customers/${process.env.GOOGLE_ADS_CUSTOMER_ID}/campaigns/${campaign.id}`,
              { status: 'PAUSED' }
            );
          }

          this._logAdsActivity('marcos', 'otimizacao_google', `${opt.reason} - Campanha: ${campaign.name}`, opt.action);
        }

        // Verificar search terms para negativas
        const { data: searchTerms } = await googleAds.getSearchTerms({ campaignId: campaign.id });
        const negativeCandidates = this._findNegativeKeywords(searchTerms);

        if (negativeCandidates.length > 0) {
          await googleAds.addNegativeKeywords(campaign.id, negativeCandidates);
          acoes.push({
            action: 'add_negatives',
            reason: `${negativeCandidates.length} palavras-chave negativas adicionadas: ${negativeCandidates.slice(0, 5).join(', ')}`,
            severity: 'baixa',
            keywords: negativeCandidates
          });
          this._logAdsActivity('marcos', 'negativas_adicionadas', `${negativeCandidates.length} negativas na campanha ${campaign.name}`);
        }
      }
    } catch (error) {
      console.error('[ADS-OPTIMIZER] Erro na otimizacao Google:', error.message);
    }

    return acoes;
  }

  _aggregateGoogleMetrics(metrics) {
    let totalCost = 0, totalClicks = 0, totalImpressions = 0, totalConversions = 0;

    for (const day of metrics) {
      totalCost += day.cost || 0;
      totalClicks += day.clicks || 0;
      totalImpressions += day.impressions || 0;
      totalConversions += day.conversions || 0;
    }

    return {
      cost: totalCost,
      clicks: totalClicks,
      impressions: totalImpressions,
      conversions: totalConversions,
      cpc: totalClicks > 0 ? totalCost / totalClicks : 0,
      ctr: totalImpressions > 0 ? (totalClicks / totalImpressions * 100) : 0,
      cpa: totalConversions > 0 ? totalCost / totalConversions : 0,
      convRate: totalClicks > 0 ? (totalConversions / totalClicks * 100) : 0,
      days: metrics.length,
    };
  }

  _applyGoogleRules(campaign, metrics) {
    const rules = [];
    const cpaMeta = parseFloat(process.env.ADS_CPA_GOOGLE_TARGET || 60);

    // CPA muito alto
    if (metrics.cpa > cpaMeta * 2 && metrics.days >= 3 && metrics.conversions > 0) {
      rules.push({
        action: 'pause_campaign',
        reason: `CPA R$${metrics.cpa.toFixed(2)} muito acima da meta R$${cpaMeta}`,
        severity: 'alta',
      });
    }

    // CTR baixo para Search
    if (metrics.ctr < 2 && metrics.impressions > 500) {
      rules.push({
        action: 'alert_ad_copy',
        reason: `CTR ${metrics.ctr.toFixed(2)}% baixo para Search (meta >3%). Revisar copy dos anuncios`,
        severity: 'media',
      });
    }

    // Sem conversoes com gasto alto
    if (metrics.conversions === 0 && metrics.cost > cpaMeta * 3) {
      rules.push({
        action: 'pause_campaign',
        reason: `R$${metrics.cost.toFixed(2)} gastos sem conversoes. Pausando`,
        severity: 'critica',
      });
    }

    // Performance excelente
    if (metrics.cpa > 0 && metrics.cpa < cpaMeta * 0.6 && metrics.conversions >= 3) {
      rules.push({
        action: 'increase_budget',
        reason: `CPA R$${metrics.cpa.toFixed(2)} excelente. Escalar orcamento`,
        severity: 'positiva',
      });
    }

    return rules;
  }

  _findNegativeKeywords(searchTerms) {
    if (!searchTerms) return [];

    const negativePatterns = [
      'gratis', 'gratuito', 'free', 'curso', 'emprego', 'vaga',
      'como ser provedor', 'como montar', 'salario', 'concurso',
      'download', 'tutorial', 'pdf', 'apostila', 'faculdade'
    ];

    const candidates = [];

    for (const term of searchTerms) {
      // Cliques sem conversao e custo alto
      if (term.clicks > 3 && term.conversions === 0 && term.cost > 10) {
        const termLower = term.term.toLowerCase();
        // Verificar se contem padroes negativos
        if (negativePatterns.some(p => termLower.includes(p))) {
          candidates.push(term.term);
        }
      }
    }

    return candidates;
  }

  // === ANALISE COM IA (Marcos) ===

  async getAIAnalysis() {
    try {
      // Coleta metricas de ambas plataformas
      let metaInsights = null, googleMetrics = null;

      try {
        metaInsights = await metaAds.getAccountInsights({ datePreset: 'last_7d' });
      } catch (e) { /* Meta nao configurado */ }

      try {
        googleMetrics = await googleAds.getCampaignMetrics();
      } catch (e) { /* Google nao configurado */ }

      const prompt = `
Analise os dados de performance das campanhas de midia paga do Consulta ISP e forneca:

1. RESUMO EXECUTIVO: Como estao as campanhas (bom/medio/ruim)
2. TOP PERFORMERS: Quais campanhas/anuncios estao melhores
3. PROBLEMAS: O que precisa de atencao imediata
4. ACOES RECOMENDADAS: Lista priorizada do que fazer agora
5. PREVISAO: Se mantivermos o ritmo, quantos leads teremos esse mes

DADOS META ADS (ultimos 7 dias):
${metaInsights ? JSON.stringify(metaInsights.data, null, 2) : 'Nao configurado'}

DADOS GOOGLE ADS (ultimos 7 dias):
${googleMetrics ? JSON.stringify(googleMetrics.data, null, 2) : 'Nao configurado'}

Responda de forma direta e pratica, como um gestor de trafego experiente.`;

      const result = await claude.sendToAgent('marcos', prompt);
      return result;
    } catch (error) {
      console.error('[ADS-OPTIMIZER] Erro na analise IA:', error.message);
      throw error;
    }
  }

  // === CRIACAO DE CAMPANHA COM IA ===

  async createCampaignWithAI({ platform, objective, region, budget, description }) {
    const prompt = `
Preciso criar uma campanha de ${platform} para o Consulta ISP.

Objetivo: ${objective}
Regiao: ${region || 'Brasil'}
Orcamento diario: R$${budget || 50}
Descricao: ${description || 'Gerar leads de provedores de internet'}

Responda em JSON com a estrutura completa da campanha:
{
  "campaign_name": "nome da campanha",
  "objective": "objetivo da plataforma",
  "daily_budget": numero,
  "targeting": {
    "interests": ["lista de interesses"],
    "age_min": numero,
    "age_max": numero,
    "regions": ["regioes"],
    "keywords": ["se Google Ads"]
  },
  "ad_copies": [
    {
      "headline": "titulo",
      "description": "descricao",
      "cta": "call to action"
    }
  ],
  "negative_keywords": ["se Google Ads"],
  "notes": "observacoes estrategicas"
}`;

    try {
      const result = await claude.sendToAgent('marcos', prompt);
      const jsonMatch = result.resposta.match(/\{[\s\S]*\}/);

      if (jsonMatch) {
        return { success: true, plan: JSON.parse(jsonMatch[0]), raw: result.resposta };
      }

      return { success: true, raw: result.resposta };
    } catch (error) {
      console.error('[ADS-OPTIMIZER] Erro ao planejar campanha:', error.message);
      throw error;
    }
  }

  // === RELATORIO COMPLETO ===

  async generateReport(period = 'last_7d') {
    const db = getDb();
    const report = {
      period,
      generated_at: new Date().toISOString(),
      meta_ads: null,
      google_ads: null,
      optimizations: [],
      summary: null,
    };

    try {
      report.meta_ads = await metaAds.getAccountInsights({ datePreset: period });
    } catch (e) {
      report.meta_ads = { error: 'Meta Ads nao configurado' };
    }

    try {
      report.google_ads = await googleAds.getCampaignMetrics();
    } catch (e) {
      report.google_ads = { error: 'Google Ads nao configurado' };
    }

    // Buscar otimizacoes recentes
    try {
      report.optimizations = db.prepare(
        "SELECT * FROM atividades_agentes WHERE agente = 'marcos' ORDER BY criado_em DESC LIMIT 20"
      ).all();
    } catch (e) { /* tabela pode nao existir ainda */ }

    // Gerar analise IA
    try {
      const analysis = await this.getAIAnalysis();
      report.summary = analysis.resposta;
    } catch (e) {
      report.summary = 'Analise IA indisponivel';
    }

    return report;
  }

  // Registra atividade do Marcos no banco
  _logAdsActivity(agente, tipo, descricao, decisao = null) {
    try {
      const db = getDb();
      db.prepare(
        `INSERT INTO atividades_agentes (agente, tipo, descricao, decisao) VALUES (?,?,?,?)`
      ).run(agente, tipo, descricao, decisao);
    } catch (e) {
      console.error('[ADS-OPTIMIZER] Erro ao logar atividade:', e.message);
    }
  }
}

module.exports = new AdsOptimizer();
