-- Sprint 5 / T1: nova tabela campanhas (Broadcast Engine)
-- Preserva tabela antiga renomeando para campanhas_legacy (caso exista com schema v1).

-- 1. Se existir tabela campanhas com schema ANTIGO (tipo/agente/regiao/mensagem_template), renomear
--    A detecao e feita via PRAGMA table_info no runner JS (migrations.js) antes de aplicar esse SQL.

CREATE TABLE IF NOT EXISTS campanhas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nome TEXT NOT NULL,
  audiencia_id INTEGER NOT NULL REFERENCES audiencias(id),
  template_id INTEGER NOT NULL REFERENCES templates(id),
  agente_remetente TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'rascunho' CHECK(status IN
    ('rascunho','agendada','enviando','pausada','concluida','falhou','cancelada')),
  rate_limit_per_min INTEGER DEFAULT 20,
  jitter_min_sec INTEGER DEFAULT 3,
  jitter_max_sec INTEGER DEFAULT 8,
  iniciada_em DATETIME,
  concluida_em DATETIME,
  agendada_para DATETIME,
  total_envios INTEGER DEFAULT 0,
  enviados_count INTEGER DEFAULT 0,
  entregues_count INTEGER DEFAULT 0,
  lidos_count INTEGER DEFAULT 0,
  respondidos_count INTEGER DEFAULT 0,
  falhas_count INTEGER DEFAULT 0,
  bloqueados_count INTEGER DEFAULT 0,
  criada_por TEXT,
  criado_em DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_campanhas_status ON campanhas(status);
CREATE INDEX IF NOT EXISTS idx_campanhas_agendada ON campanhas(agendada_para) WHERE status = 'agendada';
