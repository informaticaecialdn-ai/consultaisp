-- 0024 — a ponte com o Chat BullQ (05/09/2026)
--
-- Pedido do dono: chat com o cliente dentro de Cobranca e Equipamentos, "para
-- que o usuario consiga enviar e conversar com o cliente que ele vai cobrar ou
-- buscar o equipamento, direto aqui no sistema", usando o Chat BullQ (o
-- sistema de atendimento que ele comprou com o curso da Bravy). Decisao de
-- arquitetura: o Chat BullQ roda a parte (chat-api.consultaisp.com.br) e o
-- Consulta ISP fala com ele pela API — uma Organization de la por provedor
-- daqui, um Channel de la por numero de WhatsApp.
--
-- Duas tabelas, as duas com provider_id (regra 8 do CLAUDE.md):
--
--   chat_bullq_integracoes — a organizacao do provedor no Chat BullQ e o canal
--     de WhatsApp escolhido. Uma por provedor. Nenhum segredo aqui: o token do
--     canal fica no Chat BullQ e o acesso do Consulta ISP e pela chave de
--     plataforma (env), que emite o token do dono da organizacao na hora.
--
--   chat_bullq_conversas — a conversa aberta la, amarrada ao que a originou
--     aqui: o caso de cobranca ou o caso de recuperacao de equipamento. E o
--     que deixa o kanban e o 360 mostrarem "conversa aberta" e a linha do tempo
--     do caso receber o que aconteceu no chat.
--
-- Idempotente (IF NOT EXISTS).

CREATE TABLE IF NOT EXISTS chat_bullq_integracoes (
  id              SERIAL PRIMARY KEY,
  provider_id     INTEGER NOT NULL REFERENCES providers(id),
  organization_id TEXT NOT NULL,
  slug            TEXT NOT NULL,
  owner_email     TEXT NOT NULL,
  canal_id        TEXT,
  canal_nome      TEXT,
  -- 'provisionado' (org criada, sem canal) · 'ativo' (canal testado) · 'erro'
  status          TEXT NOT NULL DEFAULT 'provisionado',
  ultimo_erro     TEXT,
  created_at      TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS chat_bullq_integracoes_provider ON chat_bullq_integracoes (provider_id);

CREATE TABLE IF NOT EXISTS chat_bullq_conversas (
  id                 SERIAL PRIMARY KEY,
  provider_id        INTEGER NOT NULL REFERENCES providers(id),
  customer_id        INTEGER NOT NULL REFERENCES customers(id),
  caso_id            INTEGER REFERENCES cobranca_casos(id),
  recuperacao_id     INTEGER REFERENCES equipment_recovery_cases(id),
  -- 'cobranca' | 'equipamentos'
  origem             TEXT NOT NULL,
  conversation_id    TEXT NOT NULL,
  canal_id           TEXT NOT NULL,
  aberta_por_user_id INTEGER REFERENCES users(id),
  -- status como o Chat BullQ devolve: PENDING · BOT · OPEN · WAITING · CLOSED
  status             TEXT NOT NULL DEFAULT 'BOT',
  aberta_em          TIMESTAMP NOT NULL DEFAULT NOW(),
  ultimo_evento_em   TIMESTAMP,
  created_at         TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS chat_bullq_conversas_conversa ON chat_bullq_conversas (provider_id, conversation_id);
CREATE INDEX IF NOT EXISTS idx_chat_bullq_conversas_caso ON chat_bullq_conversas (provider_id, caso_id) WHERE caso_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_chat_bullq_conversas_recuperacao ON chat_bullq_conversas (provider_id, recuperacao_id) WHERE recuperacao_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_chat_bullq_conversas_cliente ON chat_bullq_conversas (provider_id, customer_id);
