-- Sprint 3 / T5: log de erros capturados (uncaught / express).
CREATE TABLE IF NOT EXISTS errors_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tipo TEXT NOT NULL,
  mensagem TEXT NOT NULL,
  stack TEXT,
  contexto TEXT,
  correlation_id TEXT,
  resolvido BOOLEAN DEFAULT 0,
  criado_em DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_errors_log_resolvido ON errors_log(resolvido);
CREATE INDEX IF NOT EXISTS idx_errors_log_data ON errors_log(criado_em);
