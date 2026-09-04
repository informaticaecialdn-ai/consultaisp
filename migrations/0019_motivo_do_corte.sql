-- Por que o contrato do cliente acabou, e ha quanto tempo.
--
-- MEDIDO em 04/09/2026 contra o SGP real da Amplinet (provedor 6). O dono
-- cobrava "mais de 300 clientes inadimplentes cancelados" e a nossa base
-- mostrava 27. A investigacao passou por um caminho errado antes de achar o
-- certo, e vale registrar os dois:
--
--   ERRADO — ler os titulos CANCELADOS do SGP e chamar de divida o que estava
--   vencido no dia em que foi anulado. Dava R$ 552.952 em 546 clientes. Mas
--   fatura anulada e decisao contabil do provedor, nao comportamento do
--   cliente, e o proprio SGP desmente a conta: numa amostra de 80 contratos
--   cancelados, apenas 4 (5%) tinham saldo em aberto declarado. Projetado,
--   ~14 de 275 — praticamente os 24 que ja liamos por `status=abertos`.
--   Cancelar o contrato zera o saldo, e inferir divida dali seria inventar.
--
--   CERTO — o contrato ja diz por que acabou, e nos jogavamos fora:
--
--     Suspenso  · Financeiro       225 contratos · 222 clientes
--     Cancelado · Administrativo   214 · 206
--     Ativo     · Financeiro        76 ·  76
--     Cancelado · Financeiro        65 ·  65
--     Suspenso  · Administrativo    31 ·  30
--     Cancelado · Financeiro - SPC   1 ·   1
--
--   222 + 66 = 288 clientes cortados por falta de pagamento, dito pelo ERP do
--   provedor. Esse e o numero que ele via. E 258 desses contratos estao
--   cortados ha mais de dois anos.
--
-- O que faltava no bureau, entao, nao era dinheiro: era o MOTIVO. Sem ele,
-- quem pediu para sair (214 contratos) fica identico a quem foi cortado por
-- calote (66) — e essa e exatamente a diferenca que um bureau de credito
-- existe para registrar.

-- Texto CRU do ERP, sem CHECK de proposito. Cada ERP escreve com a redacao
-- dele, e "Financeiro - SPC" ja e um valor que ninguem tinha previsto; um CHECK
-- aqui viraria erro de sincronizacao no dia em que um provedor cadastrar um
-- motivo novo. A normalizacao para as duas familias vive em
-- shared/motivo-corte.ts, onde conector, score e tela leem a mesma regra.
ALTER TABLE customers ADD COLUMN IF NOT EXISTS motivo_corte TEXT;

-- Quando o contrato mudou para o status atual (`data_status` no SGP). Um corte
-- de tres anos atras pesa diferente de um de tres meses, e sem esta data o
-- score trataria os dois igual.
ALTER TABLE customers ADD COLUMN IF NOT EXISTS cortado_em TIMESTAMP;

-- A consulta que importa: "quem foi cortado por dinheiro", por provedor. O
-- indice e parcial porque a coluna e nula para a maioria — todo provedor cujo
-- ERP nao devolve motivo, e todo cliente ativo.
CREATE INDEX IF NOT EXISTS idx_customers_motivo_corte
  ON customers (provider_id, motivo_corte)
  WHERE motivo_corte IS NOT NULL;
