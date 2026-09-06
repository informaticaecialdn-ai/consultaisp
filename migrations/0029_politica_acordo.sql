-- 0029 — cobranca_politica ganha a POLITICA DE ACORDO, por carteira (06/09/2026)
--
-- Ate aqui o provedor configurava um envelope so (`negociacao`: desconto max,
-- parcelas max, entrada minima, saldo minimo) para a carteira inteira. O
-- acordo automatico — o chat hoje, o portal do ex-cliente depois — precisa de
-- mais: a regua e o risco de quem AINDA e cliente nao sao os de quem ja foi
-- embora, e dentro de cada carteira o que se pode oferecer muda com os dias
-- de atraso.
--
-- Uma coluna JSONB nova, `acordo`, com uma configuracao por carteira:
--   origemDaCobranca      onde a cobranca do acordo NASCE. Decisao do dono,
--                         06/09/2026, literal: "fica na decisao do provedor".
--                         nao_definida | asaas | erp | manual. Enquanto for
--                         `nao_definida` NENHUMA oferta com desconto e gerada:
--                         so o valor integral, pela segunda via do proprio ERP
--                         ("o portal de acordo do ex-cliente sai primeiro so
--                         com pagar o valor integral").
--   faixas                por dias de atraso: ate quantos dias, quanto de
--                         desconto, quantas parcelas, quanta entrada. Ordenadas
--                         e sem sobreposicao nem buraco (shared/cobranca/acordo.ts).
--   janelaVencimentoDias  em quantos dias a frente o devedor escolhe a data da
--                         primeira parcela (a janela do credor).
--   tetoDeExcecaoPct      o quanto alem da faixa um pedido pode ir e ainda ser
--   parcelasDeExcecao     levado a um humano aprovar; fora disso e recusa direta.
--
-- O envelope geral continua sendo o teto: `clampAcordo` puxa qualquer faixa que
-- passe do `descontoMaxPct`/`maxParcelas` de `negociacao` e diz o que puxou.
--
-- O DEFAULT abaixo e igual a POLITICA_DE_COBRANCA_PADRAO.acordo em
-- shared/schema.ts e a ACORDO_PADRAO em shared/cobranca/acordo.ts — ha teste
-- comparando as tres copias, string por string.
--
-- Idempotente: ADD COLUMN IF NOT EXISTS + SET DEFAULT. Aplica no boot da API
-- (server/migrate.ts). Nenhuma linha existente muda de comportamento: a origem
-- nasce nao definida, e sem origem nao ha desconto.

ALTER TABLE cobranca_politica
  ADD COLUMN IF NOT EXISTS acordo JSONB NOT NULL
  DEFAULT '{"ativo":{"origemDaCobranca":"nao_definida","faixas":[{"acimaDeDias":0,"ateDias":30,"descontoMaxPct":0,"maxParcelas":1,"entradaMinimaPct":100},{"acimaDeDias":30,"ateDias":60,"descontoMaxPct":5,"maxParcelas":2,"entradaMinimaPct":50},{"acimaDeDias":60,"ateDias":null,"descontoMaxPct":10,"maxParcelas":3,"entradaMinimaPct":30}],"janelaVencimentoDias":10,"tetoDeExcecaoPct":20,"parcelasDeExcecao":6},"ex_cliente":{"origemDaCobranca":"nao_definida","faixas":[{"acimaDeDias":0,"ateDias":90,"descontoMaxPct":10,"maxParcelas":3,"entradaMinimaPct":30},{"acimaDeDias":90,"ateDias":180,"descontoMaxPct":15,"maxParcelas":4,"entradaMinimaPct":25},{"acimaDeDias":180,"ateDias":null,"descontoMaxPct":20,"maxParcelas":6,"entradaMinimaPct":20}],"janelaVencimentoDias":10,"tetoDeExcecaoPct":20,"parcelasDeExcecao":6}}'::jsonb;

-- Se a coluna ja existia de uma execucao anterior com outro default, o valor
-- corrente e o do codigo: SET DEFAULT e barato e mantem as tres copias iguais.
ALTER TABLE cobranca_politica
  ALTER COLUMN acordo SET DEFAULT '{"ativo":{"origemDaCobranca":"nao_definida","faixas":[{"acimaDeDias":0,"ateDias":30,"descontoMaxPct":0,"maxParcelas":1,"entradaMinimaPct":100},{"acimaDeDias":30,"ateDias":60,"descontoMaxPct":5,"maxParcelas":2,"entradaMinimaPct":50},{"acimaDeDias":60,"ateDias":null,"descontoMaxPct":10,"maxParcelas":3,"entradaMinimaPct":30}],"janelaVencimentoDias":10,"tetoDeExcecaoPct":20,"parcelasDeExcecao":6},"ex_cliente":{"origemDaCobranca":"nao_definida","faixas":[{"acimaDeDias":0,"ateDias":90,"descontoMaxPct":10,"maxParcelas":3,"entradaMinimaPct":30},{"acimaDeDias":90,"ateDias":180,"descontoMaxPct":15,"maxParcelas":4,"entradaMinimaPct":25},{"acimaDeDias":180,"ateDias":null,"descontoMaxPct":20,"maxParcelas":6,"entradaMinimaPct":20}],"janelaVencimentoDias":10,"tetoDeExcecaoPct":20,"parcelasDeExcecao":6}}'::jsonb;
