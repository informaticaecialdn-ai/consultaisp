-- Sprint 4 stubs (audiencias / templates) necessarios para Sprint 5 referenciar.
-- Implementacao minima. O Sprint 4 real substituira com schema mais completo.

CREATE TABLE IF NOT EXISTS audiencias (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nome TEXT NOT NULL,
  descricao TEXT,
  tipo TEXT NOT NULL DEFAULT 'estatica' CHECK(tipo IN ('estatica','dinamica')),
  filtros TEXT,
  total_leads INTEGER DEFAULT 0,
  criado_em DATETIME DEFAULT CURRENT_TIMESTAMP,
  atualizado_em DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_audiencias_tipo ON audiencias(tipo);

CREATE TABLE IF NOT EXISTS audiencia_leads (
  audiencia_id INTEGER NOT NULL,
  lead_id INTEGER NOT NULL,
  criado_em DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (audiencia_id, lead_id)
);

CREATE INDEX IF NOT EXISTS idx_audiencia_leads_audiencia ON audiencia_leads(audiencia_id);
CREATE INDEX IF NOT EXISTS idx_audiencia_leads_lead ON audiencia_leads(lead_id);

CREATE TABLE IF NOT EXISTS templates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nome TEXT NOT NULL,
  descricao TEXT,
  conteudo TEXT NOT NULL,
  agente TEXT,
  variaveis TEXT,
  versao INTEGER DEFAULT 1,
  ja_aprovado_meta INTEGER DEFAULT 0,
  criado_em DATETIME DEFAULT CURRENT_TIMESTAMP,
  atualizado_em DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_templates_agente ON templates(agente);

CREATE TABLE IF NOT EXISTS lead_opt_out (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  telefone TEXT NOT NULL UNIQUE,
  motivo TEXT,
  canal TEXT DEFAULT 'whatsapp',
  criado_em DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_lead_opt_out_telefone ON lead_opt_out(telefone);
