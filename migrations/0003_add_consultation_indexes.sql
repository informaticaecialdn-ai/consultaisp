CREATE INDEX IF NOT EXISTS idx_isp_consultations_cpf_date ON isp_consultations(cpf_cnpj, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_isp_consultations_provider_date ON isp_consultations(provider_id, created_at DESC);
