-- Spec 003: WhatsApp + Júlia + Helena (autorizado 2026-05-11)
-- Adiciona 7 tabelas: communications, audit_logs, agent_memories, compliance_checks, agreements, whatsapp_accounts, whatsapp_optouts

-- 1. communications
CREATE TABLE IF NOT EXISTS communications (
  id SERIAL PRIMARY KEY,
  provider_id INTEGER NOT NULL REFERENCES providers(id),
  customer_id INTEGER NOT NULL REFERENCES customers(id),
  channel VARCHAR(20) NOT NULL,
  direction VARCHAR(20) NOT NULL,
  template_name TEXT,
  content TEXT NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'pending',
  external_message_id TEXT,
  sent_at TIMESTAMP,
  delivered_at TIMESTAMP,
  read_at TIMESTAMP,
  agent_id TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS communications_provider_customer_created_idx
  ON communications(provider_id, customer_id, created_at DESC);
CREATE INDEX IF NOT EXISTS communications_external_message_id_idx
  ON communications(external_message_id);

-- 2. audit_logs — IMUTÁVEL via trigger
CREATE TABLE IF NOT EXISTS audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id INTEGER NOT NULL REFERENCES providers(id),
  action TEXT NOT NULL,
  resource TEXT NOT NULL,
  resource_id TEXT NOT NULL,
  actor_type VARCHAR(20) NOT NULL,
  actor_id TEXT,
  actor_name TEXT,
  payload JSONB,
  legal_basis TEXT,
  legal_references TEXT[] DEFAULT '{}',
  notification_proof JSONB,
  occurred_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS audit_logs_provider_occurred_idx
  ON audit_logs(provider_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS audit_logs_provider_resource_idx
  ON audit_logs(provider_id, resource, resource_id);

-- 3. agent_memories
CREATE TABLE IF NOT EXISTS agent_memories (
  id SERIAL PRIMARY KEY,
  customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  agent_id TEXT NOT NULL,
  facts JSONB DEFAULT '[]'::jsonb,
  promises JSONB DEFAULT '[]'::jsonb,
  topics TEXT[] DEFAULT '{}',
  sentiment_history JSONB DEFAULT '[]'::jsonb,
  summary TEXT,
  last_interaction_at TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS agent_memories_customer_agent_uq
  ON agent_memories(customer_id, agent_id);

-- 4. compliance_checks
CREATE TABLE IF NOT EXISTS compliance_checks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id INTEGER NOT NULL REFERENCES providers(id),
  customer_id INTEGER NOT NULL REFERENCES customers(id),
  agent_id TEXT,
  proposed_action JSONB NOT NULL,
  decision VARCHAR(30) NOT NULL,
  legal_basis TEXT,
  legal_references TEXT[] DEFAULT '{}',
  adjustments JSONB,
  blocking_reasons TEXT[],
  latency_ms INTEGER,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS compliance_checks_provider_created_idx
  ON compliance_checks(provider_id, created_at DESC);
CREATE INDEX IF NOT EXISTS compliance_checks_customer_decision_idx
  ON compliance_checks(customer_id, decision);

-- 5. agreements
CREATE TABLE IF NOT EXISTS agreements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id INTEGER NOT NULL REFERENCES providers(id),
  customer_id INTEGER NOT NULL REFERENCES customers(id),
  invoice_ids INTEGER[] NOT NULL,
  type VARCHAR(30) NOT NULL,
  total_value DECIMAL(10, 2) NOT NULL,
  discount_percent DECIMAL(5, 2) DEFAULT '0',
  installments JSONB DEFAULT '[]'::jsonb,
  status VARCHAR(20) NOT NULL DEFAULT 'pending',
  agreed_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expected_fulfillment_at TIMESTAMP,
  fulfilled_at TIMESTAMP,
  broken_at TIMESTAMP,
  agent_id TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS agreements_provider_created_idx
  ON agreements(provider_id, created_at DESC);
CREATE INDEX IF NOT EXISTS agreements_customer_status_idx
  ON agreements(customer_id, status);

-- 6. whatsapp_accounts
CREATE TABLE IF NOT EXISTS whatsapp_accounts (
  id SERIAL PRIMARY KEY,
  provider_id INTEGER NOT NULL UNIQUE REFERENCES providers(id) ON DELETE CASCADE,
  waba_id TEXT NOT NULL UNIQUE,
  phone_number_id TEXT NOT NULL UNIQUE,
  display_name TEXT,
  access_token_encrypted TEXT NOT NULL,
  waba_status VARCHAR(20) DEFAULT 'pending',
  quality_rating VARCHAR(10),
  verified_at TIMESTAMP,
  token_expires_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 7. whatsapp_optouts
CREATE TABLE IF NOT EXISTS whatsapp_optouts (
  id SERIAL PRIMARY KEY,
  provider_id INTEGER NOT NULL REFERENCES providers(id),
  phone_number TEXT NOT NULL,
  opted_out_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  reason TEXT,
  is_permanent BOOLEAN DEFAULT TRUE
);
CREATE UNIQUE INDEX IF NOT EXISTS whatsapp_optouts_provider_phone_uq
  ON whatsapp_optouts(provider_id, phone_number);
