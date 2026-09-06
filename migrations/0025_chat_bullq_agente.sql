-- 0025 — o agente de IA do Chat BullQ ganha uma porta no Consulta ISP (05/09/2026)
--
-- Decisao (o dono perguntou "o chatbullq ja tem agentes, da para usar eles?";
-- verificado no codigo: da): o agente de cobranca do provedor, no Chat BullQ,
-- chama o Consulta ISP por skills HTTP — consulta o caso pelo telefone,
-- registra a promessa de pagamento, avisa a transferencia. Quem autentica
-- essas chamadas e uma CHAVE POR PROVEDOR, gerada aqui e entregue ao Chat
-- BullQ como header da tool. Guardamos so o SHA-256 dela; a chave crua vai
-- para o Chat BullQ e nunca volta.
--
-- E o caminho de volta: o Chat BullQ avisa (automacao call_webhook) quando a
-- IA transfere ao atendente ou alguem assume a conversa; a assinatura
-- HMAC-SHA256 do aviso usa um segredo por provedor, gerado aqui.
--
-- Quatro colunas novas em chat_bullq_integracoes; idempotente.

ALTER TABLE chat_bullq_integracoes ADD COLUMN IF NOT EXISTS chave_agente_hash TEXT;
ALTER TABLE chat_bullq_integracoes ADD COLUMN IF NOT EXISTS agente_id TEXT;
-- ids da tool, das skills e das automacoes criadas no Chat BullQ, para nao recriar
ALTER TABLE chat_bullq_integracoes ADD COLUMN IF NOT EXISTS agente_config JSONB;
ALTER TABLE chat_bullq_integracoes ADD COLUMN IF NOT EXISTS webhook_secret TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS chat_bullq_integracoes_chave_agente ON chat_bullq_integracoes (chave_agente_hash) WHERE chave_agente_hash IS NOT NULL;
