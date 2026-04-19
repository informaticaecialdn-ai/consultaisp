-- Sprint 7: integracao Apify para prospeccao automatizada.
-- Tabela rastreia cada execucao de actor + leads importados.

CREATE TABLE IF NOT EXISTS apify_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  actor_id TEXT NOT NULL,                  -- ex: 'compass/crawler-google-places'
  actor_label TEXT,                        -- 'Google Maps Scraper'
  apify_run_id TEXT,                       -- id retornado pela API Apify
  params TEXT,                             -- JSON dos inputs do actor
  status TEXT DEFAULT 'pending'
    CHECK(status IN ('pending','running','succeeded','failed','timed-out','aborted','imported')),
  items_count INTEGER DEFAULT 0,           -- itens retornados pelo actor
  leads_novos INTEGER DEFAULT 0,           -- leads inseridos
  leads_dup INTEGER DEFAULT 0,             -- leads duplicados (telefone existente)
  leads_invalidos INTEGER DEFAULT 0,       -- itens sem dados minimos
  cost_usd REAL DEFAULT 0,
  duracao_ms INTEGER,
  iniciada_por TEXT,                       -- email/identificador
  iniciado_em DATETIME DEFAULT CURRENT_TIMESTAMP,
  finalizado_em DATETIME,
  importado_em DATETIME,
  erro TEXT
);

CREATE INDEX IF NOT EXISTS idx_apify_runs_status ON apify_runs(status);
CREATE INDEX IF NOT EXISTS idx_apify_runs_actor ON apify_runs(actor_id);
CREATE INDEX IF NOT EXISTS idx_apify_runs_data ON apify_runs(iniciado_em);

-- Adiciona coluna pra rastrear de que run o lead veio (nullable, nao quebra existentes).
ALTER TABLE leads ADD COLUMN apify_run_id INTEGER REFERENCES apify_runs(id);
ALTER TABLE leads ADD COLUMN dados_externos TEXT;  -- JSON raw do Apify (rating, reviews, etc.)
CREATE INDEX IF NOT EXISTS idx_leads_apify_run ON leads(apify_run_id);
