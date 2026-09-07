-- 0031 — indice de invoices por CLIENTE (06/09/2026)
--
-- A Economia do cliente (R24) no 360 passou a tirar o ARPU das faturas do ERP:
-- a mensalidade que o provedor de fato cobra daquele assinante, que e o unico
-- caminho vivo de ARPU hoje (`customers` nao guarda o plano, e o mapa de precos
-- por plano nasce vazio). Isso criou DUAS consultas novas por cliente, e a
-- tabela `invoices` nao tinha indice nenhum por `customer_id`: so
-- `invoices_pkey`, `idx_invoices_provider_due` e o unico de (provider, fonte, ref).
--
-- Medido na producao ANTES deste indice, com 46.309 faturas e 13.203 clientes
-- de contrato vivo: a consulta de cobertura da tela de Politica levou
-- 38.033 ms — trinta e oito segundos, a cada abertura da tela. O `EXISTS`
-- por cliente virava varredura sequencial da tabela inteira, 13 mil vezes.
--
-- A coluna lider e `provider_id` e nao `customer_id` de proposito: toda
-- consulta deste sistema filtra por provedor antes de qualquer coisa
-- (multi-tenant), entao o mesmo indice serve a leitura de um cliente
-- (mensalidadeDoCliente) e a varredura da carteira (coberturaDaMensalidade).
--
-- Aditivo e reversivel: nao cria coluna, nao altera dado, e sai com um
-- DROP INDEX. Idempotente — aplica no boot da API (server/migrate.ts), que
-- roda cada arquivo dentro de uma transacao (por isso nao ha CONCURRENTLY;
-- em 46 mil linhas a criacao e instantanea).

CREATE INDEX IF NOT EXISTS idx_invoices_provider_customer
  ON invoices (provider_id, customer_id);
