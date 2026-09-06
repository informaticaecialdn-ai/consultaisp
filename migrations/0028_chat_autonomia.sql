-- Fila durável do motor controlado. Desligado por padrão; nenhuma cobrança é criada.
CREATE TABLE IF NOT EXISTS chat_autonomia_config (
  provider_id INTEGER PRIMARY KEY REFERENCES providers(id),
  config JSONB NOT NULL DEFAULT '{"ativa":false}',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS chat_autonomia_estado (
  provider_id INTEGER NOT NULL REFERENCES providers(id),
  conversation_id TEXT NOT NULL,
  turnos INTEGER NOT NULL DEFAULT 0 CHECK (turnos >= 0),
  humano BOOLEAN NOT NULL DEFAULT false,
  proposta JSONB,
  motivo TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (provider_id, conversation_id),
  FOREIGN KEY (provider_id, conversation_id) REFERENCES chat_bullq_conversas(provider_id, conversation_id)
);
CREATE TABLE IF NOT EXISTS chat_autonomia_fila (
  id BIGSERIAL PRIMARY KEY,
  provider_id INTEGER NOT NULL REFERENCES providers(id),
  conversation_id TEXT NOT NULL,
  message_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pendente' CHECK (status IN ('pendente','processando','enviando','concluido','humano','cancelado')),
  motivo TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (provider_id, message_id),
  FOREIGN KEY (provider_id, conversation_id) REFERENCES chat_bullq_conversas(provider_id, conversation_id)
);
CREATE INDEX IF NOT EXISTS chat_autonomia_pendente ON chat_autonomia_fila(status, id);
