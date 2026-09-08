-- 0032 — o agregado de equipamento passa a ser MEDIDO, não presumido (08/09/2026)
--
-- `customers.equipment_count` nasceu com DEFAULT 1 e `equipment_estimated_value`
-- com DEFAULT '290'. Ou seja: todo cliente que entrava no sistema já entrava
-- afirmando ter um equipamento de R$ 290 em comodato — sem que ninguém tivesse
-- medido nada.
--
-- Isso não é enfeite de coluna. Esses dois campos alimentam o cálculo de
-- prejuízo do Anti-Fraude (`server/routes/antifraude.routes.ts`, `equipCount` e
-- `equipValue`), que é o número que o provedor lê para decidir o que fazer com
-- um cliente. A própria spec do módulo denunciou isso em 21/08/2026: "o sistema
-- PRESUME que todo cliente tem um equipamento de R$290. Esse número falso já
-- alimenta o cálculo de prejuízo do Anti-Fraude."
--
-- O código já foi corrigido: `upsertFromErp` parou de reescrever os defaults e
-- `recalculateCustomerEquipmentAggregate` calcula a partir da tabela `equipment`
-- no POST, no PATCH e no sync. Mas as linhas antigas ficaram com o número
-- inventado, e o DEFAULT seguia cunhando novas.
--
-- MEDIDO NA PRODUÇÃO antes desta migração:
--   equipment_count = 1 · valor = 290,00  →  32.214 clientes
--   equipment_count = 0 · valor = 0,00    →   1.025 clientes
--   equipamentos de verdade na tabela `equipment`: 324 (322 do ERP, 2 na mão)
-- Ou seja: 32.214 afirmações de patrimônio para 324 aparelhos que existem.
--
-- Autorizado pelo dono em 08/09/2026.
--
-- A DEFINIÇÃO DE "RETIDO" abaixo é a MESMA de `contarEquipamentoRetido`
-- (server/storage/equipment.storage.ts). Ela precisa ser: se a migração contar
-- diferente do código, a primeira varredura de ERP reescreve tudo com outro
-- número e o susto volta ao contrário.

-- SEM `BEGIN;`/`COMMIT;` aqui, e isso importa: `server/migrate.ts` já abre a
-- transação, roda o arquivo e só então grava a linha em `_migrations`. Um
-- `COMMIT` no meio do arquivo FECHA a transação do runner: o registro no ledger
-- passaria a rodar solto, e uma falha depois dele deixaria a migração aplicada
-- pela metade sem nada para desfazer. Nenhuma das outras 33 migrações traz
-- BEGIN/COMMIT — esta não é exceção.

-- 1. O default para de mentir. Cliente novo entra com zero até que se meça.
ALTER TABLE customers ALTER COLUMN equipment_count SET DEFAULT 0;
ALTER TABLE customers ALTER COLUMN equipment_estimated_value SET DEFAULT 0;

-- 2. Zera o passivo. O `IS DISTINCT FROM` deixa a migração barata ao reaplicar
--    e evita reescrever 33 mil linhas que já estão certas.
UPDATE customers
   SET equipment_count = 0,
       equipment_estimated_value = 0
 WHERE equipment_count IS DISTINCT FROM 0
    OR equipment_estimated_value IS DISTINCT FROM 0;

-- 3. Grava o que existe de verdade, por cliente, a partir da tabela `equipment`.
--    `provider_id` entra no casamento junto com `customer_id`: sem ele, um id de
--    cliente repetido entre provedores somaria patrimônio de outro tenant.
WITH retido AS (
  SELECT e.provider_id,
         e.customer_id,
         COUNT(*)::int AS n,
         COALESCE(SUM(e.value), 0)::numeric(10, 2) AS total
    FROM equipment e
   WHERE e.customer_id IS NOT NULL
     AND LOWER(e.status) IN (
           'retirada_pendente', 'nao_localizado', 'retido', 'em_cobranca', 'not_returned'
         )
   GROUP BY e.provider_id, e.customer_id
)
UPDATE customers c
   SET equipment_count = r.n,
       equipment_estimated_value = r.total
  FROM retido r
 WHERE c.id = r.customer_id
   AND c.provider_id = r.provider_id
   AND (c.equipment_count IS DISTINCT FROM r.n
        OR c.equipment_estimated_value IS DISTINCT FROM r.total);

