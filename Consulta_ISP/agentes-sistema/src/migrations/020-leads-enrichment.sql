-- Enrichment pipeline: Apify contact-info-scraper + ReceitaWS.
-- Popula leads.cnpj / razao_social / emails_extras / telefones_extras / redes_sociais
-- automaticamente APOS import do prospector, antes do cold outbound.

ALTER TABLE leads ADD COLUMN emails_extras TEXT;        -- JSON array de emails adicionais
ALTER TABLE leads ADD COLUMN telefones_extras TEXT;     -- JSON array de telefones extras
ALTER TABLE leads ADD COLUMN redes_sociais TEXT;        -- JSON: {linkedin:[], facebook:[], instagram:[], twitter:[], youtube:[]}
ALTER TABLE leads ADD COLUMN enriched_at DATETIME;      -- null = nao enriquecido ainda
ALTER TABLE leads ADD COLUMN enrich_source TEXT;        -- 'apify_contact_info' | 'manual' | 'receita_only'
ALTER TABLE leads ADD COLUMN enrich_erro TEXT;          -- mensagem de erro se enrichment falhou

CREATE INDEX IF NOT EXISTS idx_leads_enriched ON leads(enriched_at);
