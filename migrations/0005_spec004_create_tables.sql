-- Spec 004 — Bruno (preventivo) + Sofia (agradecimento) + Pix dinâmico
-- Autorizado pelo owner em 2026-05-11
-- 5 tabelas + índices. Idempotente (IF NOT EXISTS) para coexistir com drizzle-kit push.

-- 1. asaas_accounts ---------------------------------------------------------
CREATE TABLE IF NOT EXISTS asaas_accounts (
  id SERIAL PRIMARY KEY,
  provider_id INTEGER NOT NULL UNIQUE REFERENCES providers(id),
  api_key_encrypted TEXT NOT NULL,
  webhook_token_encrypted TEXT,
  mode VARCHAR(10) NOT NULL DEFAULT 'sandbox',
  account_status VARCHAR(20) NOT NULL DEFAULT 'pending',
  last_used_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- 2. pix_charges ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS pix_charges (
  id SERIAL PRIMARY KEY,
  provider_id INTEGER NOT NULL REFERENCES providers(id),
  invoice_id INTEGER NOT NULL REFERENCES invoices(id),
  customer_id INTEGER NOT NULL REFERENCES customers(id),
  asaas_payment_id TEXT NOT NULL UNIQUE,
  value NUMERIC(12,2) NOT NULL,
  due_date DATE NOT NULL,
  pix_qr_code_base64 TEXT,
  pix_copy_paste TEXT,
  pix_expires_at TIMESTAMP,
  status VARCHAR(20) NOT NULL DEFAULT 'pending',
  paid_at TIMESTAMP,
  cancelled_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS pix_charges_provider_status_idx
  ON pix_charges (provider_id, status);
CREATE INDEX IF NOT EXISTS pix_charges_invoice_idx
  ON pix_charges (invoice_id);
CREATE INDEX IF NOT EXISTS pix_charges_provider_due_idx
  ON pix_charges (provider_id, due_date);

-- 3. payment_events ---------------------------------------------------------
CREATE TABLE IF NOT EXISTS payment_events (
  id SERIAL PRIMARY KEY,
  provider_id INTEGER NOT NULL REFERENCES providers(id),
  asaas_payment_id TEXT NOT NULL,
  event_type VARCHAR(40) NOT NULL,
  external_event_id TEXT,
  payload JSONB NOT NULL,
  received_at TIMESTAMP NOT NULL DEFAULT NOW(),
  processing_status VARCHAR(20) NOT NULL DEFAULT 'processed',
  rejection_reason TEXT,
  sofia_job_id TEXT
);

-- FR-008: idempotência por (provider, payment, event)
CREATE UNIQUE INDEX IF NOT EXISTS payment_events_provider_payment_event_uq
  ON payment_events (provider_id, asaas_payment_id, event_type);
CREATE INDEX IF NOT EXISTS payment_events_received_at_idx
  ON payment_events (received_at);
CREATE INDEX IF NOT EXISTS payment_events_processing_status_idx
  ON payment_events (processing_status);

-- 4. agent_toggles ----------------------------------------------------------
CREATE TABLE IF NOT EXISTS agent_toggles (
  id SERIAL PRIMARY KEY,
  provider_id INTEGER NOT NULL UNIQUE REFERENCES providers(id),
  bruno_ativo BOOLEAN NOT NULL DEFAULT FALSE,
  sofia_ativa BOOLEAN NOT NULL DEFAULT FALSE,
  scheduler_hora_local VARCHAR(8) NOT NULL DEFAULT '09:00:00',
  janela_inicio VARCHAR(8) NOT NULL DEFAULT '08:00:00',
  janela_fim VARCHAR(8) NOT NULL DEFAULT '20:00:00',
  permite_sabado BOOLEAN NOT NULL DEFAULT TRUE,
  permite_domingo BOOLEAN NOT NULL DEFAULT FALSE,
  template_bruno_nome TEXT,
  template_sofia_nome TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- 5. outbound_attempts ------------------------------------------------------
CREATE TABLE IF NOT EXISTS outbound_attempts (
  id SERIAL PRIMARY KEY,
  provider_id INTEGER NOT NULL REFERENCES providers(id),
  customer_id INTEGER NOT NULL REFERENCES customers(id),
  invoice_id INTEGER REFERENCES invoices(id),
  pix_charge_id INTEGER REFERENCES pix_charges(id),
  agent_id VARCHAR(40) NOT NULL,
  step VARCHAR(20) NOT NULL,
  scheduled_for TIMESTAMP NOT NULL,
  status VARCHAR(30) NOT NULL DEFAULT 'scheduled',
  attempt_count INTEGER NOT NULL DEFAULT 0,
  next_retry_at TIMESTAMP,
  compliance_check_id TEXT,
  communication_id INTEGER,
  failure_reason TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS outbound_attempts_provider_status_scheduled_idx
  ON outbound_attempts (provider_id, status, scheduled_for);
CREATE INDEX IF NOT EXISTS outbound_attempts_status_next_retry_idx
  ON outbound_attempts (status, next_retry_at);
