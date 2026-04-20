-- Campanhas de midia paga geridas pelo Marcos (agente autonomo).
-- Tracking de campanhas criadas via Meta Ads / Google Ads APIs por decisao
-- do Marcos. Permite medir performance agregada e auto-pause/auto-scale.

CREATE TABLE IF NOT EXISTS ads_campaigns (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  platform TEXT NOT NULL CHECK(platform IN ('meta', 'google')),
  external_id TEXT,                       -- ID retornado pela API (campaign_id)
  name TEXT NOT NULL,
  objective TEXT,                         -- OUTCOME_LEADS, SEARCH, etc.
  status TEXT DEFAULT 'draft'
    CHECK(status IN ('draft','active','paused','ended','error')),
  mesorregiao TEXT,                       -- slug IBGE alvo (foco regional)
  mesorregiao_nome TEXT,
  estado TEXT,                            -- UF alvo
  cidades TEXT,                           -- JSON array de municipios alvo
  budget_daily_brl REAL DEFAULT 0,
  budget_lifetime_brl REAL,
  spent_brl REAL DEFAULT 0,
  -- Performance agregada (atualizada pelo optimizer)
  impressions INTEGER DEFAULT 0,
  clicks INTEGER DEFAULT 0,
  leads_gerados INTEGER DEFAULT 0,        -- conversoes reais na base leads
  cpl_atual REAL,                         -- custo por lead acumulado
  ctr_atual REAL,                         -- click-through rate
  roas_atual REAL,                        -- return on ad spend
  -- Auditoria
  criada_por_agente TEXT DEFAULT 'marcos',
  criada_em DATETIME DEFAULT CURRENT_TIMESTAMP,
  atualizada_em DATETIME DEFAULT CURRENT_TIMESTAMP,
  ultima_otimizacao_em DATETIME,
  observacoes TEXT,                       -- razoes de pausa/escala (tex livre)
  raw_metadata TEXT                       -- JSON com config completa enviada pra API
);

CREATE INDEX IF NOT EXISTS idx_ads_campaigns_platform ON ads_campaigns(platform);
CREATE INDEX IF NOT EXISTS idx_ads_campaigns_status ON ads_campaigns(status);
CREATE INDEX IF NOT EXISTS idx_ads_campaigns_meso ON ads_campaigns(mesorregiao);
CREATE INDEX IF NOT EXISTS idx_ads_campaigns_agente ON ads_campaigns(criada_por_agente);

-- Decisoes do Marcos (timeline do que ele fez: criou, pausou, escalou)
CREATE TABLE IF NOT EXISTS ads_decisions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ads_campaign_id INTEGER,
  action TEXT NOT NULL,                   -- 'create','pause','scale','activate','adjust_budget','adjust_target'
  reason TEXT,                            -- motivo (CPL alto, CTR baixo, etc.)
  metrics_snapshot TEXT,                  -- JSON das metricas no momento da decisao
  valor_novo TEXT,                        -- novo budget/alvo (se aplicavel)
  criada_em DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (ads_campaign_id) REFERENCES ads_campaigns(id)
);

CREATE INDEX IF NOT EXISTS idx_ads_decisions_campaign ON ads_decisions(ads_campaign_id);
CREATE INDEX IF NOT EXISTS idx_ads_decisions_data ON ads_decisions(criada_em);
