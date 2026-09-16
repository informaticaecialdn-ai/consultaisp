-- Segredos por provedor, cifrados com AES-256-GCM antes de persistir.
CREATE TABLE IF NOT EXISTS cobranca_canais_config (
  provider_id integer PRIMARY KEY REFERENCES providers(id) ON DELETE CASCADE,
  config_cifrada text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
