-- Milestone pos-M3: enriquecimento via ReceitaWS (CNPJ).
-- Adiciona cnpj + dados_receita (JSON raw da API) + dados_receita_at (timestamp cache).

ALTER TABLE leads ADD COLUMN cnpj TEXT;
ALTER TABLE leads ADD COLUMN dados_receita TEXT;
ALTER TABLE leads ADD COLUMN dados_receita_at DATETIME;
ALTER TABLE leads ADD COLUMN razao_social TEXT;
ALTER TABLE leads ADD COLUMN situacao_receita TEXT;

CREATE INDEX IF NOT EXISTS idx_leads_cnpj ON leads(cnpj);
