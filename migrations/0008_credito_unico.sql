-- Credito unico: um saldo so, valido para toda consulta do sistema.
--
-- Havia tres bolsos — isp_credits, spc_credits e bigdata_credits — e a tela de
-- compra so alimentava o primeiro: ela sempre vendeu "creditos universais" e
-- gravou tudo em isp_credits. O resultado que o provedor via era um saldo de
-- 187 creditos com a Consulta Cadastral respondendo "saldo insuficiente, voce
-- tem 0", porque ela debitava de bigdata_credits.
--
-- Aqui os saldos dos outros dois bolsos sao somados ao universal e zerados.
-- Ninguem perde credito: quem comprou SPC no modelo antigo passa a poder usar
-- aquele saldo em qualquer consulta, que e mais permissivo do que era antes.
--
-- As colunas NAO sao removidas. `credit_orders` e `provider_invoices` guardam
-- quanto de cada tipo foi vendido em pedidos historicos, e apagar a coluna
-- apagaria a leitura desses registros. Elas ficam em zero e nenhuma compra nova
-- as alimenta — ver CREDIT_PACKAGES em shared/schema.ts.

UPDATE providers
SET isp_credits     = isp_credits + spc_credits + bigdata_credits,
    spc_credits     = 0,
    bigdata_credits = 0
WHERE spc_credits > 0 OR bigdata_credits > 0;
