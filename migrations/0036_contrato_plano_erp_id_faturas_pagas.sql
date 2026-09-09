-- A Economia do contrato ENCERRADO (decisao do dono, 09/09/2026): o resultado
-- do inicio ao cancelamento, com os valores realmente pagos, o saldo devedor e
-- o ponto de equilibrio. Tres coisas que o sync lia e descartava, ou nunca lia:
--
--   customers.contract_plan    o plano com o nome que o ERP escreve (MK
--                              plano_acesso, IXC contrato, SGP planointernet)
--   customers.erp_customer_id  o id do cliente NO ERP (MK CodigoPessoa, IXC
--                              cliente.id, SGP clienteId) — chave das leituras
--                              por cliente e da fatura paga que so vem com o id
--   invoices.paid_value        o valor PAGO como o ERP registrou; so em fatura
--                              com status 'paid' confirmada pelo ERP
--
-- Sem BEGIN/COMMIT: o runner (server/migrate.ts) envolve cada arquivo numa
-- transacao — um COMMIT aqui fecharia a dele e o ROLLBACK nao desfaria nada.
ALTER TABLE customers ADD COLUMN IF NOT EXISTS contract_plan text;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS erp_customer_id text;
CREATE INDEX IF NOT EXISTS idx_customers_provider_erp_customer
  ON customers (provider_id, erp_source, erp_customer_id) WHERE erp_customer_id IS NOT NULL;

ALTER TABLE invoices ADD COLUMN IF NOT EXISTS paid_value numeric(10,2);
CREATE INDEX IF NOT EXISTS idx_invoices_provider_paid
  ON invoices (provider_id, paid_date) WHERE status = 'paid';
