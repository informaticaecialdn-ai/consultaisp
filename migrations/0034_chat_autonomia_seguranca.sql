-- Confirmação server-side com validade curta e ofertas calculadas pela política.
-- Sem documentos completos nem dígitos de desafio persistidos.
CREATE TABLE IF NOT EXISTS chat_autonomia_seguranca (
  provider_id integer NOT NULL REFERENCES providers(id),
  conversation_id text NOT NULL,
  identidade jsonb,
  ofertas jsonb,
  updated_at timestamp NOT NULL DEFAULT now(),
  CONSTRAINT chat_autonomia_seguranca_vinculo FOREIGN KEY (provider_id, conversation_id)
    REFERENCES chat_bullq_conversas(provider_id, conversation_id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS chat_autonomia_seguranca_conversa
  ON chat_autonomia_seguranca(provider_id, conversation_id);
CREATE TABLE IF NOT EXISTS chat_autonomia_autorizacao (
  provider_id integer PRIMARY KEY REFERENCES providers(id),
  user_id integer NOT NULL REFERENCES users(id),
  updated_at timestamp NOT NULL DEFAULT now()
);
