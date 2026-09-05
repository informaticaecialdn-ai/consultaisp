-- 0023 — cobranca_politica.economia ganha `precoPorPlano` (05/09/2026)
--
-- A Economia do cliente (R24) da ficha 360 precisa do ARPU — a mensalidade do
-- plano. O sync do ERP nao traz o VALOR do plano, so o NOME (pelo ERP ao
-- vivo), e o Provedor.ai o le de `clientes.valor_mensal`, que aqui nao
-- existe. A solucao e a tabela plano → mensalidade dentro da propria
-- politica: `economia.precoPorPlano = { "Fibra 300": 119.9 }`. Plano sem
-- preco cadastrado = Economia PENDENTE no 360, com o motivo — nunca um chute.
--
-- Chave nova no JSONB, sem coluna nova. O DEFAULT continua igual a
-- POLITICA_DE_COBRANCA_PADRAO.economia em shared/schema.ts e a
-- POLITICA_PADRAO.economia em shared/cobranca/politica.ts (ha teste). As
-- linhas ja gravadas recebem a chave vazia para o JSON gravado bater com o
-- que o Zod devolve (que ja aplica `{}` por default na leitura).
--
-- Idempotente: SET DEFAULT pode rodar de novo; o UPDATE so toca linha sem a chave.

ALTER TABLE cobranca_politica ALTER COLUMN economia SET DEFAULT '{"cac":0,"capexInstalacao":0,"equipamentoResidual":0,"opexLink":0,"opexRedePop":0,"opexSuporte":0,"opexManutencaoNoc":0,"impostoReceitaPct":0,"cicloMeses":36,"confirmado":false,"precoPorPlano":{}}'::jsonb;

UPDATE cobranca_politica
   SET economia = economia || '{"precoPorPlano":{}}'::jsonb
 WHERE NOT (economia ? 'precoPorPlano');
