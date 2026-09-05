-- Cobranca, fase 2 — o fluxo do operador e os custos da Economia do cliente.
--
-- Decisoes do dono em 05/09/2026, depois da fase 1 (migracao 0021):
--
--   (a) A tela operacional e um KANBAN, e o fluxo dele pede dois status que a
--       fase 1 nao tinha:
--         · `em_contato`  — o operador ja falou com o cliente e aguarda. Separa
--                           "ninguem ligou ainda" de "estamos conversando".
--         · `cancelamento` — TERMINAL. O contrato entrou em cancelamento (pelo
--                           ERP ou pela mao do operador), com motivo obrigatorio
--                           e a sugestao de abrir a recuperacao do equipamento.
--       `em_contato` e so mais um valor na coluna TEXT `status` — nada muda no
--       banco. `cancelamento` muda: e FECHADO, e a lista de fechados esta
--       repetida literalmente no predicado dos dois indices parciais de
--       `cobranca_casos`. Sem recria-los, um cliente com caso em cancelamento
--       nao poderia ter caso novo (o indice unico ainda o veria como vivo) e a
--       fila carregaria casos que nao existem mais para o operador.
--
--   (d) Os custos POR PROVEDOR da Economia do cliente (R24 do Provedor.ai)
--       entram na politica como JSONB `economia`: CAC, CAPEX de instalacao,
--       residual do equipamento, os quatro OPEX, imposto sobre receita, o ciclo
--       em meses e `confirmado`. Enquanto `confirmado` for false a tela mostra
--       o selo "≈ parametros padrao", exatamente como o Provedor.ai faz — nada
--       de numero inventado passando por dado.
--
-- Postgres nao tem ALTER INDEX ... WHERE: predicado de indice parcial so muda
-- com DROP + CREATE. Os dois rodam na transacao da migracao (server/migrate.ts
-- faz BEGIN/COMMIT por arquivo), entao ou os dois indices trocam de predicado
-- ou nenhum troca. `cobranca_casos` nasceu na 0021 e ainda esta vazia em
-- producao — o lock do CREATE INDEX nao segura ninguem.
--
-- Idempotente: IF NOT EXISTS na coluna e nos indices, IF EXISTS no DROP. Rodar
-- duas vezes recria os indices iguais e nao muda a coluna.

-- ── cobranca_politica.economia ──────────────────────────────────────────────
-- O DEFAULT e o mesmo de POLITICA_DE_COBRANCA_PADRAO.economia em shared/schema.ts
-- e de POLITICA_PADRAO.economia em shared/cobranca/politica.ts, e precisa
-- continuar igual (ha teste que le este arquivo): custos zero, ciclo de 36
-- meses (o padrao do Provedor.ai) e `confirmado: false`. Imposto e percentual
-- em pontos (18 = 18%), como todo percentual da politica.
ALTER TABLE cobranca_politica ADD COLUMN IF NOT EXISTS economia JSONB NOT NULL
  DEFAULT '{"cac":0,"capexInstalacao":0,"equipamentoResidual":0,"opexLink":0,"opexRedePop":0,"opexSuporte":0,"opexManutencaoNoc":0,"impostoReceitaPct":0,"cicloMeses":36,"confirmado":false}'::jsonb;

-- ── cobranca_casos: os indices parciais com `cancelamento` entre os fechados ─
-- A lista e STATUS_CASO_FECHADO de shared/schema.ts, repetida literalmente —
-- ha teste que le este arquivo e confere as duas ocorrencias. `negativado`
-- continua VIVO (ver 0021).
DROP INDEX IF EXISTS cobranca_casos_um_aberto_por_cliente;
CREATE UNIQUE INDEX IF NOT EXISTS cobranca_casos_um_aberto_por_cliente
  ON cobranca_casos (provider_id, customer_id)
  WHERE status NOT IN ('pago', 'baixado', 'encerrado', 'cancelamento');

DROP INDEX IF EXISTS idx_cobranca_casos_fila;
CREATE INDEX IF NOT EXISTS idx_cobranca_casos_fila
  ON cobranca_casos (provider_id, responsavel_user_id, proximo_contato_em)
  WHERE status NOT IN ('pago', 'baixado', 'encerrado', 'cancelamento');
