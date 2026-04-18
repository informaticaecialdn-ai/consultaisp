-- Sprint 3 / T2: tracking de custo Claude.
CREATE TABLE IF NOT EXISTS claude_usage (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  agente TEXT NOT NULL,
  modelo TEXT NOT NULL,
  input_tokens INTEGER NOT NULL,
  output_tokens INTEGER NOT NULL,
  custo_usd REAL NOT NULL,
  prices_verified_at TEXT,
  lead_id INTEGER,
  contexto TEXT,
  correlation_id TEXT,
  duracao_ms INTEGER,
  criado_em DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_claude_usage_data ON claude_usage(criado_em);
CREATE INDEX IF NOT EXISTS idx_claude_usage_agente ON claude_usage(agente);
