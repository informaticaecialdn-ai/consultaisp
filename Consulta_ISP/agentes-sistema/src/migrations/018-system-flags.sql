-- Milestone 3 / G: kill switches + flags do sistema persistentes.
-- Usado pelo auto-healer (cross-process: API agentes + worker compartilham).

CREATE TABLE IF NOT EXISTS system_flags (
  key TEXT PRIMARY KEY,
  value TEXT,                          -- JSON value (string, boolean, objeto)
  reason TEXT,                         -- motivo quando aplicavel (ex: kill switch)
  set_by TEXT,                         -- 'auto_healer' | 'manual' | agente
  atualizado_em DATETIME DEFAULT CURRENT_TIMESTAMP
);
