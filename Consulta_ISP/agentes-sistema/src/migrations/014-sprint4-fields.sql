-- Sprint 4 / T1-T3: campos adicionais em audiencias, templates e lead_opt_out.
-- As tabelas vem do stub 008-sprint4-stubs.sql; aqui adicionamos o que faltava
-- para o schema definitivo (sem recriar / sem quebrar Sprint 5).

ALTER TABLE audiencias ADD COLUMN ativa BOOLEAN DEFAULT 1;
ALTER TABLE audiencias ADD COLUMN criada_por TEXT;
ALTER TABLE audiencias ADD COLUMN total_leads_atualizado_em DATETIME;

ALTER TABLE templates ADD COLUMN categoria TEXT;
ALTER TABLE templates ADD COLUMN ativo BOOLEAN DEFAULT 1;
ALTER TABLE templates ADD COLUMN meta_template_id TEXT;
ALTER TABLE templates ADD COLUMN variaveis_obrigatorias TEXT;

CREATE INDEX IF NOT EXISTS idx_templates_categoria ON templates(categoria);
CREATE INDEX IF NOT EXISTS idx_templates_ativo ON templates(ativo);
CREATE INDEX IF NOT EXISTS idx_audiencias_ativa ON audiencias(ativa);

-- lead_opt_out vira "consentimento bidirecional" (opt-in + opt-out).
-- NAO renomear a tabela: Sprint 5 referencia pelo nome atual.
ALTER TABLE lead_opt_out ADD COLUMN status TEXT DEFAULT 'optout';
ALTER TABLE lead_opt_out ADD COLUMN optin_em DATETIME;
ALTER TABLE lead_opt_out ADD COLUMN optin_origem TEXT;
ALTER TABLE lead_opt_out ADD COLUMN atualizado_em DATETIME DEFAULT CURRENT_TIMESTAMP;
