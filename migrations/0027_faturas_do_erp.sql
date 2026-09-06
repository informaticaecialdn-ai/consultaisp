-- 0027 — as FATURAS ABERTAS do ERP, fatura a fatura, na tabela invoices (05/09/2026)
--
-- Ate aqui o sync gravava so o agregado por cliente (customers.total_overdue_amount,
-- max_days_overdue, overdue_invoices_count), e `invoices` so recebia linha do
-- import CSV. O resumo do MES de vencimento — faturado, inadimplente, a vencer,
-- em conciliacao, quem ficou sem fatura — precisa da fatura em si, com o
-- vencimento dela. Mesma regra do Provedor.ai (packages/scoring/src/cockpit/safra.ts).
--
-- Cinco colunas novas:
--   erp_source  de onde veio (null = CSV/manual)
--   erp_ref     id da fatura no ERP — chave de reconhecimento entre varreduras
--   descricao   texto da fatura (no MK e onde o equipamento retido aparece)
--   baixada_em  quando NOTAMOS que ela sumiu dos pendentes (nao e data de pagamento)
--   updated_at  ultima varredura que a tocou
--
-- contract_id passa a aceitar nulo: a fatura do ERP nao tem contrato nosso.
--
-- Status das linhas do ERP: 'aberta' (pendente no ERP) e 'baixada_no_erp'
-- (sumiu dos pendentes numa varredura COMPLETA). As linhas legadas do CSV
-- seguem com pending/overdue/paid.
--
-- Idempotente: aplica no boot da API (server/migrate.ts).

ALTER TABLE invoices ADD COLUMN IF NOT EXISTS erp_source text;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS erp_ref text;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS descricao text;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS baixada_em timestamp;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS updated_at timestamp DEFAULT now();
ALTER TABLE invoices ALTER COLUMN contract_id DROP NOT NULL;

-- Parcial: so a fatura do ERP tem referencia; a do CSV pode repetir.
CREATE UNIQUE INDEX IF NOT EXISTS invoices_provider_erp_ref_uq
  ON invoices (provider_id, erp_source, erp_ref) WHERE erp_ref IS NOT NULL;
-- A pergunta do resumo mensal: faturas do provedor vencendo em [de, ate).
CREATE INDEX IF NOT EXISTS idx_invoices_provider_due ON invoices (provider_id, due_date);
