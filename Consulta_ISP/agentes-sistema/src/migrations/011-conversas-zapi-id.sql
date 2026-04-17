-- Sprint 5 / T3: vincula conversas a envios via zapi_message_id.
-- Permite correlacionar delivery/read callbacks Z-API com o envio original.

ALTER TABLE conversas ADD COLUMN zapi_message_id TEXT;
CREATE INDEX IF NOT EXISTS idx_conversas_zapi_id ON conversas(zapi_message_id);
