-- customers tinha SOMENTE a chave primaria. Medido em producao em 27/08/2026:
--
--   EXPLAIN ANALYZE SELECT id FROM customers
--    WHERE provider_id=4 AND regexp_replace(cpf_cnpj,'[^0-9]','','g')='...'
--   -> Seq Scan on customers ... Rows Removed by Filter: 32318 ... 13.868 ms
--
-- Cada upsert do sync faz essa busca. Sao ~35 mil por rodada (29.124 clientes no
-- passo 1 + 6.041 inadimplentes no passo 2), o que da cerca de 8 minutos gastos
-- so varrendo a tabela inteira, repetidamente, dentro dos ~35 min do sync.

-- 1. O caminho do sync: upsertFromErp casa por igualdade simples
--    (server/storage/customers.storage.ts) — indice composto serve direto.
CREATE INDEX IF NOT EXISTS customers_provider_cpf_idx
    ON customers (provider_id, cpf_cnpj);

-- 2. O caminho da CONSULTA: getCustomerByCpfCnpj normaliza o documento com
--    regexp_replace para casar linhas gravadas com pontuacao. Um indice comum em
--    cpf_cnpj nao e usado nessa forma — precisa ser indice de EXPRESSAO, com a
--    expressao identica a da query.
--
--    Passou a ser caminho quente agora: a consulta ISP le a base local antes de
--    ir aos ERPs (server/services/consulta-local.service.ts), entao toda
--    consulta executa esta busca.
CREATE INDEX IF NOT EXISTS customers_cpf_normalizado_idx
    ON customers ((regexp_replace(cpf_cnpj, '[^0-9]', '', 'g')));

-- 3. Isolamento multi-tenant: praticamente toda listagem filtra por provedor.
CREATE INDEX IF NOT EXISTS customers_provider_idx
    ON customers (provider_id);

-- Sem CONCURRENTLY de proposito: o runner de migracao envolve tudo em BEGIN/
-- COMMIT (server/migrate.ts) e CREATE INDEX CONCURRENTLY nao roda em transacao.
-- Com 32 mil linhas a construcao leva menos de um segundo.
