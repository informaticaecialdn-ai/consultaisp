-- Milestone 1 / C1: fila de validacao da prospeccao autonoma.
-- Apify descobre -> entra em leads_pending -> validator filtra/enriquece ->
-- aprovados viram leads com origem=prospector_auto, rejeitados sao registrados.

CREATE TABLE IF NOT EXISTS leads_pending (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source TEXT NOT NULL,                  -- 'apify_google_maps', 'apify_website_crawler', 'manual'
  source_run_id INTEGER,                 -- referencia apify_runs.id quando aplicavel
  raw_data TEXT NOT NULL,                -- JSON completo do item bruto (rating, reviews, site, endereco)
  -- Campos extraidos pra match rapido
  nome TEXT,
  provedor TEXT,
  telefone TEXT,
  email TEXT,
  cidade TEXT,
  estado TEXT,
  site TEXT,
  -- Pipeline de validacao
  status TEXT DEFAULT 'pending'
    CHECK(status IN ('pending','enriching','validating','approved','rejected','imported','duplicate')),
  score REAL DEFAULT 0,                  -- 0-1 score agregado do validator
  flags TEXT,                            -- JSON array de flags ('sem_telefone','reclame_aqui','rating_baixo', etc.)
  reasons TEXT,                          -- JSON array de motivos de aprovacao/rejeicao
  -- Enriquecimento (quando aplicavel)
  enriched_at DATETIME,
  website_content TEXT,                  -- texto extraido do site (resumido)
  contacts_found TEXT,                   -- JSON array de emails/telefones descobertos
  -- Import
  imported_lead_id INTEGER REFERENCES leads(id),
  imported_at DATETIME,
  -- Auditoria
  criado_em DATETIME DEFAULT CURRENT_TIMESTAMP,
  atualizado_em DATETIME DEFAULT CURRENT_TIMESTAMP,
  erro TEXT
);

CREATE INDEX IF NOT EXISTS idx_leads_pending_status ON leads_pending(status);
CREATE INDEX IF NOT EXISTS idx_leads_pending_source ON leads_pending(source);
CREATE INDEX IF NOT EXISTS idx_leads_pending_telefone ON leads_pending(telefone);
CREATE INDEX IF NOT EXISTS idx_leads_pending_site ON leads_pending(site);
CREATE INDEX IF NOT EXISTS idx_leads_pending_data ON leads_pending(criado_em);

-- Config do prospector (1 linha, config global da prospeccao autonoma)
CREATE TABLE IF NOT EXISTS prospector_config (
  id INTEGER PRIMARY KEY CHECK(id = 1),   -- singleton
  enabled INTEGER DEFAULT 0,              -- 0=off, 1=on
  regioes TEXT,                           -- JSON array: ['MG', 'SP', 'RS', 'PR', 'GO']
  termos TEXT,                            -- JSON array: ['provedor internet', 'internet fibra', 'ISP']
  max_leads_por_run INTEGER DEFAULT 50,
  min_rating REAL DEFAULT 3.5,            -- rating minimo Google Maps
  min_reviews INTEGER DEFAULT 3,          -- minimo reviews pra considerar real
  scraping_cron TEXT DEFAULT '0 8 * * 1,3,5',   -- seg/qua/sex 8h
  validation_cron TEXT DEFAULT '0 9 * * *',     -- diariamente 9h
  atualizado_em DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Seed do singleton (nao sobrescreve se ja existe)
INSERT OR IGNORE INTO prospector_config (id, enabled, regioes, termos)
VALUES (1, 0,
  '["MG","SP","RS","PR","GO","BA","SC"]',
  '["provedor internet","internet fibra","ISP provedor","fibra otica"]');
