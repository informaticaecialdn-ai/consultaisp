-- Gestao patrimonial e recuperacao de equipamentos em comodato.
-- Migration aditiva: preserva status e registros legados sem reclassificacao automatica.

ALTER TABLE equipment ADD COLUMN IF NOT EXISTS asset_tag TEXT;
ALTER TABLE equipment ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'manual';
ALTER TABLE equipment ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT NOW();
ALTER TABLE equipment ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT NOW();
ALTER TABLE equipment ALTER COLUMN status SET DEFAULT 'em_comodato';

ALTER TABLE customers ADD COLUMN IF NOT EXISTS equipment_count INTEGER DEFAULT 0;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS equipment_estimated_value DECIMAL(10, 2) DEFAULT 0;
ALTER TABLE customers ALTER COLUMN equipment_count SET DEFAULT 0;
ALTER TABLE customers ALTER COLUMN equipment_estimated_value SET DEFAULT 0;

CREATE TABLE IF NOT EXISTS equipment_recovery_cases (
  id SERIAL PRIMARY KEY,
  provider_id INTEGER NOT NULL REFERENCES providers(id),
  equipment_id INTEGER NOT NULL REFERENCES equipment(id),
  customer_id INTEGER NOT NULL REFERENCES customers(id),
  status TEXT NOT NULL DEFAULT 'pre_recuperacao',
  priority TEXT NOT NULL DEFAULT 'normal',
  termination_date TIMESTAMP NOT NULL,
  deadline_at TIMESTAMP NOT NULL,
  scheduled_at TIMESTAMP,
  collection_method TEXT,
  assigned_to_user_id INTEGER REFERENCES users(id),
  proof_reference TEXT,
  customer_notified_at TIMESTAMP,
  notification_protocol TEXT,
  evidence_validated_at TIMESTAMP,
  evidence_validated_by_id INTEGER REFERENCES users(id),
  bureau_status TEXT NOT NULL DEFAULT 'candidato',
  disputed_at TIMESTAMP,
  dispute_reason TEXT,
  closed_at TIMESTAMP,
  notes TEXT,
  created_by_id INTEGER NOT NULL REFERENCES users(id),
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS equipment_recovery_events (
  id SERIAL PRIMARY KEY,
  provider_id INTEGER NOT NULL REFERENCES providers(id),
  case_id INTEGER NOT NULL REFERENCES equipment_recovery_cases(id),
  user_id INTEGER REFERENCES users(id),
  type TEXT NOT NULL,
  channel TEXT,
  result TEXT,
  from_status TEXT,
  to_status TEXT,
  notes TEXT,
  metadata JSONB,
  occurred_at TIMESTAMP DEFAULT NOW(),
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_equipment_provider_customer
  ON equipment (provider_id, customer_id);
CREATE INDEX IF NOT EXISTS idx_equipment_provider_serial
  ON equipment (provider_id, lower(serial_number))
  WHERE serial_number IS NOT NULL AND serial_number <> '';
CREATE INDEX IF NOT EXISTS idx_recovery_cases_provider_status
  ON equipment_recovery_cases (provider_id, status, deadline_at);
CREATE INDEX IF NOT EXISTS idx_recovery_cases_equipment_open
  ON equipment_recovery_cases (provider_id, equipment_id)
  WHERE closed_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_recovery_cases_bureau
  ON equipment_recovery_cases (provider_id, bureau_status, deadline_at)
  WHERE closed_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_recovery_events_case
  ON equipment_recovery_events (provider_id, case_id, occurred_at DESC);
