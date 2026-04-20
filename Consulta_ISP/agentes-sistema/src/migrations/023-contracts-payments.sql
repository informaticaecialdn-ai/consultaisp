-- Contratos + cobrancas (P0 do Rafael).
-- Permite Lucas/Rafael fechar deal com PDF contrato + Asaas cobranca.

CREATE TABLE IF NOT EXISTS proposals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  lead_id INTEGER NOT NULL,
  plano TEXT NOT NULL CHECK(plano IN ('gratuito','basico','profissional','enterprise')),
  valor_mensal REAL NOT NULL,
  valor_customizado REAL,                  -- valor com desconto (se houver)
  roi_resumo TEXT,                         -- justificativa do ROI
  validade_ate DATETIME,
  pdf_path TEXT,                           -- caminho local do PDF gerado
  pdf_url TEXT,                            -- URL publica (opcional)
  enviada_via TEXT DEFAULT 'whatsapp',
  status TEXT DEFAULT 'enviada'
    CHECK(status IN ('enviada','vista','aceita','recusada','expirada')),
  criada_por_agente TEXT DEFAULT 'lucas',
  criada_em DATETIME DEFAULT CURRENT_TIMESTAMP,
  atualizada_em DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (lead_id) REFERENCES leads(id)
);

CREATE INDEX IF NOT EXISTS idx_proposals_lead ON proposals(lead_id);
CREATE INDEX IF NOT EXISTS idx_proposals_status ON proposals(status);

CREATE TABLE IF NOT EXISTS contracts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  lead_id INTEGER NOT NULL,
  proposal_id INTEGER,
  numero TEXT UNIQUE,                      -- formato: CT-YYYY-NNNNNN
  plano TEXT NOT NULL,
  valor_mensal REAL NOT NULL,
  data_inicio DATE NOT NULL,
  data_termino DATE,                       -- null se vigencia indeterminada
  pdf_path TEXT,                           -- caminho local
  pdf_url TEXT,                            -- URL publica
  signed_at DATETIME,                      -- quando cliente confirmou aceite
  status TEXT DEFAULT 'gerado'
    CHECK(status IN ('gerado','enviado','assinado','cancelado')),
  forma_pagamento TEXT CHECK(forma_pagamento IN ('pix','boleto','cartao','outro')),
  criada_por_agente TEXT DEFAULT 'rafael',
  criada_em DATETIME DEFAULT CURRENT_TIMESTAMP,
  atualizada_em DATETIME DEFAULT CURRENT_TIMESTAMP,
  observacoes TEXT,
  FOREIGN KEY (lead_id) REFERENCES leads(id),
  FOREIGN KEY (proposal_id) REFERENCES proposals(id)
);

CREATE INDEX IF NOT EXISTS idx_contracts_lead ON contracts(lead_id);
CREATE INDEX IF NOT EXISTS idx_contracts_status ON contracts(status);

CREATE TABLE IF NOT EXISTS payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  lead_id INTEGER NOT NULL,
  contract_id INTEGER,
  asaas_id TEXT,                           -- ID retornado pela Asaas
  asaas_invoice_url TEXT,                  -- link da fatura/boleto/QRcode PIX
  asaas_pix_payload TEXT,                  -- copia-e-cola PIX
  valor REAL NOT NULL,
  due_date DATE NOT NULL,
  forma TEXT CHECK(forma IN ('PIX','BOLETO','CREDIT_CARD','UNDEFINED')),
  status TEXT DEFAULT 'pending'
    CHECK(status IN ('pending','received','overdue','refunded','cancelled')),
  paid_at DATETIME,
  webhook_payload TEXT,                    -- ultimo payload do webhook Asaas
  criada_por_agente TEXT DEFAULT 'rafael',
  criada_em DATETIME DEFAULT CURRENT_TIMESTAMP,
  atualizada_em DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (lead_id) REFERENCES leads(id),
  FOREIGN KEY (contract_id) REFERENCES contracts(id)
);

CREATE INDEX IF NOT EXISTS idx_payments_lead ON payments(lead_id);
CREATE INDEX IF NOT EXISTS idx_payments_status ON payments(status);
CREATE INDEX IF NOT EXISTS idx_payments_asaas ON payments(asaas_id);

-- Ad creatives gerados pelo Leo (cache pra reuso + tracking)
CREATE TABLE IF NOT EXISTS ad_creatives (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ads_campaign_id INTEGER,                 -- nullable (pode ser standalone)
  platform TEXT,                           -- 'meta' | 'google' | 'generic'
  mesorregiao TEXT,
  objetivo TEXT,                           -- 'leads', 'awareness', 'conversao'
  headlines TEXT,                          -- JSON array (3-5 strings, max 30 chars)
  descriptions TEXT,                       -- JSON array (2-4 strings, max 90 chars)
  body_long TEXT,                          -- texto longo (Meta primary text)
  cta TEXT,                                -- LEARN_MORE, SIGN_UP, GET_QUOTE, etc.
  variant_id TEXT,                         -- 'A','B','C' para A/B test
  used_count INTEGER DEFAULT 0,
  criada_por_agente TEXT DEFAULT 'leo',
  criada_em DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (ads_campaign_id) REFERENCES ads_campaigns(id)
);

CREATE INDEX IF NOT EXISTS idx_creatives_meso ON ad_creatives(mesorregiao);
CREATE INDEX IF NOT EXISTS idx_creatives_campaign ON ad_creatives(ads_campaign_id);
