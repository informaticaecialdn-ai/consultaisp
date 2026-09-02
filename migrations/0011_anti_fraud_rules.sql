-- Regras do anti-fraude por provedor (shared/antifraude-regras.ts).
--
-- O provedor escolhe o que quer que o anti-fraude vigie na propria base:
-- cliente ativo inadimplente (padrao), cliente novo, cliente consultado por
-- varios provedores, qualquer cliente ativo. Uma linha por (provedor, tipo);
-- o que nao esta gravado vale o padrao — por isso nao ha seed.
--
-- `parametros` e JSONB porque cada regra tem os seus (valor minimo, dias,
-- quantidade de provedores) e uma coluna por parametro viraria "coluna cujo
-- sentido depende da linha". O Zod em shared valida o formato ao gravar.
--
-- Escrito a mao, como a 0009 e a 0010: `drizzle-kit push` e interativo.

CREATE TABLE IF NOT EXISTS anti_fraud_rules (
  id          SERIAL PRIMARY KEY,
  provider_id INTEGER NOT NULL REFERENCES providers(id),
  tipo        TEXT NOT NULL,
  ativo       BOOLEAN NOT NULL DEFAULT TRUE,
  parametros  JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at  TIMESTAMP DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS anti_fraud_rules_provider_tipo
  ON anti_fraud_rules (provider_id, tipo);
