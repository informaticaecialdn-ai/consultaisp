-- Regionalizacao IBGE: mesorregiao (recorte certo pra "migracao serial" de cliente inadimplente).
-- Substitui o uso de regiao=cidade (redundante) por um campo mesorregiao_slug de verdade.

-- Coluna estruturada em leads
ALTER TABLE leads ADD COLUMN mesorregiao TEXT;         -- slug ex: "norte-central-paranaense"
ALTER TABLE leads ADD COLUMN mesorregiao_nome TEXT;    -- ex: "Norte Central Paranaense"

CREATE INDEX IF NOT EXISTS idx_leads_mesorregiao ON leads(mesorregiao);
CREATE INDEX IF NOT EXISTS idx_leads_estado ON leads(estado);

-- Adiciona mesma estrutura em leads_pending
ALTER TABLE leads_pending ADD COLUMN mesorregiao TEXT;
ALTER TABLE leads_pending ADD COLUMN mesorregiao_nome TEXT;
CREATE INDEX IF NOT EXISTS idx_leads_pending_mesorregiao ON leads_pending(mesorregiao);

-- Expande prospector_config pra aceitar mesorregioes alem dos UFs antigos.
-- Formato novo: mesorregioes = JSON array de { uf, slug } (ex: [{"uf":"PR","slug":"norte-central-paranaense"}])
ALTER TABLE prospector_config ADD COLUMN mesorregioes TEXT DEFAULT '[]';

-- Tabela de cobertura por mesorregiao — metrics agregadas pra UI (populada via SELECT agregado).
-- Nao e cache materializado, so view-style via query — opcional.

-- Atualiza seed do prospector_config: se regioes = defaults antigos, migra pra mesorregioes padrao
-- (Norte Central Paranaense como exemplo — pronto pra teste).
UPDATE prospector_config
SET mesorregioes = '[{"uf":"PR","slug":"norte-central-paranaense","nome":"Norte Central Paranaense"}]'
WHERE id = 1 AND (mesorregioes IS NULL OR mesorregioes = '[]' OR mesorregioes = '');
