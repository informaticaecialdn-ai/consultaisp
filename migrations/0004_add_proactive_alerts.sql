-- Migration: Add proactive alerts for migration notifications
-- When Provider B consults a CPF belonging to Provider A, Provider A gets notified

-- Add proactive alert settings to providers table
ALTER TABLE providers ADD COLUMN IF NOT EXISTS proactive_alerts_enabled BOOLEAN DEFAULT TRUE;
ALTER TABLE providers ADD COLUMN IF NOT EXISTS proactive_alert_webhook_url TEXT;

-- Create proactive_alerts table
CREATE TABLE IF NOT EXISTS proactive_alerts (
  id SERIAL PRIMARY KEY,
  provider_id INTEGER NOT NULL REFERENCES providers(id),
  cpf_cnpj VARCHAR(20) NOT NULL,
  consulting_provider_id INTEGER REFERENCES providers(id),
  channel VARCHAR(20) NOT NULL,
  sent_at TIMESTAMP DEFAULT NOW(),
  acknowledged BOOLEAN DEFAULT FALSE,
  acknowledged_at TIMESTAMP
);

-- Index for throttle lookup (same cpf + provider in last 24h)
CREATE INDEX IF NOT EXISTS idx_proactive_alerts_throttle ON proactive_alerts (cpf_cnpj, provider_id, sent_at);
