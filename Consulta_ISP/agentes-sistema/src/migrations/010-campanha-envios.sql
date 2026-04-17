-- Sprint 5 / T1: tabela campanha_envios
-- UNIQUE(campanha_id, lead_id) garante idempotencia em nivel de banco.

CREATE TABLE IF NOT EXISTS campanha_envios (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  campanha_id INTEGER NOT NULL REFERENCES campanhas(id) ON DELETE CASCADE,
  lead_id INTEGER NOT NULL REFERENCES leads(id),
  telefone TEXT NOT NULL,
  mensagem_renderizada TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pendente' CHECK(status IN
    ('pendente','processando','enviado','entregue','lido','respondido',
     'falhou','bloqueado_optout','bloqueado_window')),
  tentativas INTEGER DEFAULT 0,
  proximo_retry DATETIME,
  zapi_message_id TEXT,
  enviado_em DATETIME,
  entregue_em DATETIME,
  lido_em DATETIME,
  respondido_em DATETIME,
  erro TEXT,
  criado_em DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(campanha_id, lead_id)
);

CREATE INDEX IF NOT EXISTS idx_envios_status ON campanha_envios(status);
CREATE INDEX IF NOT EXISTS idx_envios_proximo_retry ON campanha_envios(proximo_retry) WHERE status = 'pendente';
CREATE INDEX IF NOT EXISTS idx_envios_campanha ON campanha_envios(campanha_id);
CREATE INDEX IF NOT EXISTS idx_envios_zapi_id ON campanha_envios(zapi_message_id);
