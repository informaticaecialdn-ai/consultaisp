-- 0043 — créditos com centavos (16/09/2026).
--
-- Decisão do dono: a consulta SPC passa a custar 2,9 créditos (R$ 2,90). O saldo
-- único do provedor, `providers.isp_credits`, era INTEGER: debitar 2,9 dele
-- arredondava para 3 no próprio Postgres, e o preço anunciado não seria o cobrado.
-- A coluna vira numeric(12,2), com o valor atual preservado e o default de 50
-- (créditos de boas-vindas do cadastro) mantido.
--
-- Só esta coluna muda. `credit_orders.isp_credits`, `provider_invoices.isp_credits_included`
-- e `plan_changes.isp_credits_added` seguem inteiras — pacote e crédito de plano são
-- inteiros. `spc_consultations` guarda o custo cobrado em `result.creditosCobrados`
-- (JSON), e `isp_consultations.cost` continua 1, inteiro.
ALTER TABLE providers ALTER COLUMN isp_credits DROP DEFAULT;
ALTER TABLE providers ALTER COLUMN isp_credits TYPE numeric(12,2) USING isp_credits::numeric(12,2);
ALTER TABLE providers ALTER COLUMN isp_credits SET DEFAULT 50;
ALTER TABLE providers ALTER COLUMN isp_credits SET NOT NULL;
