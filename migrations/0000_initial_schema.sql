-- Migration: Initial schema baseline
-- Creates all tables defined in shared/schema.ts with IF NOT EXISTS for idempotency.
-- Ordered to satisfy foreign key dependencies.
-- Date: 2026-04-07

-- 1. providers (no FK deps)
CREATE TABLE IF NOT EXISTS providers (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  trade_name TEXT,
  cnpj TEXT NOT NULL UNIQUE,
  legal_type TEXT,
  opening_date TEXT,
  business_segment TEXT,
  subdomain TEXT UNIQUE,
  plan TEXT NOT NULL DEFAULT 'free',
  status TEXT NOT NULL DEFAULT 'active',
  verification_status TEXT NOT NULL DEFAULT 'pending',
  isp_credits INTEGER NOT NULL DEFAULT 50,
  spc_credits INTEGER NOT NULL DEFAULT 0,
  contact_email TEXT,
  contact_phone TEXT,
  website TEXT,
  address_zip TEXT,
  address_street TEXT,
  address_number TEXT,
  address_complement TEXT,
  address_neighborhood TEXT,
  address_city TEXT,
  address_state TEXT,
  webhook_token TEXT,
  cidades_atendidas TEXT[] DEFAULT '{}'::text[],
  mesorregioes TEXT[] DEFAULT '{}'::text[],
  created_at TIMESTAMP DEFAULT NOW()
);

-- 2. erp_catalog (no FK deps)
CREATE TABLE IF NOT EXISTS erp_catalog (
  id SERIAL PRIMARY KEY,
  key TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  description TEXT,
  logo_base64 TEXT,
  gradient TEXT NOT NULL DEFAULT 'from-slate-500 to-slate-600',
  active BOOLEAN NOT NULL DEFAULT TRUE,
  auth_type TEXT NOT NULL DEFAULT 'bearer',
  auth_hint TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

-- 3. visitor_chats (no FK deps)
CREATE TABLE IF NOT EXISTS visitor_chats (
  id SERIAL PRIMARY KEY,
  visitor_name TEXT NOT NULL,
  visitor_email TEXT NOT NULL,
  visitor_phone TEXT,
  token TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'open',
  last_message_at TIMESTAMP DEFAULT NOW(),
  created_at TIMESTAMP DEFAULT NOW()
);

-- 4. provider_partners (-> providers)
CREATE TABLE IF NOT EXISTS provider_partners (
  id SERIAL PRIMARY KEY,
  provider_id INTEGER NOT NULL REFERENCES providers(id),
  name TEXT NOT NULL,
  cpf TEXT NOT NULL,
  birth_date TEXT,
  email TEXT,
  phone TEXT,
  role TEXT,
  share_percentage DECIMAL(5, 2),
  created_at TIMESTAMP DEFAULT NOW()
);

-- 5. provider_documents (-> providers)
CREATE TABLE IF NOT EXISTS provider_documents (
  id SERIAL PRIMARY KEY,
  provider_id INTEGER NOT NULL REFERENCES providers(id),
  document_type TEXT NOT NULL,
  document_name TEXT NOT NULL,
  document_mime_type TEXT,
  document_size INTEGER,
  file_data TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  rejection_reason TEXT,
  uploaded_by_id INTEGER REFERENCES providers(id),
  reviewed_by_id INTEGER,
  reviewer_name TEXT,
  reviewed_at TIMESTAMP,
  uploaded_at TIMESTAMP DEFAULT NOW()
);

-- 6. users (-> providers)
CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  password TEXT NOT NULL,
  name TEXT NOT NULL,
  phone TEXT,
  role TEXT NOT NULL DEFAULT 'user',
  provider_id INTEGER REFERENCES providers(id),
  email_verified BOOLEAN NOT NULL DEFAULT FALSE,
  verification_token TEXT,
  verification_token_expires_at TIMESTAMP,
  lgpd_accepted_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW()
);

-- 7. customers (-> providers)
CREATE TABLE IF NOT EXISTS customers (
  id SERIAL PRIMARY KEY,
  provider_id INTEGER NOT NULL REFERENCES providers(id),
  name TEXT NOT NULL,
  cpf_cnpj TEXT NOT NULL,
  email TEXT,
  phone TEXT,
  address TEXT,
  city TEXT,
  state TEXT,
  cep TEXT,
  address_hash TEXT,
  latitude DECIMAL(10, 7),
  longitude DECIMAL(10, 7),
  status TEXT NOT NULL DEFAULT 'active',
  payment_status TEXT NOT NULL DEFAULT 'current',
  total_overdue_amount DECIMAL(10, 2) DEFAULT '0',
  max_days_overdue INTEGER DEFAULT 0,
  overdue_invoices_count INTEGER DEFAULT 0,
  isp_score INTEGER DEFAULT 100,
  risk_tier TEXT DEFAULT 'low',
  erp_source TEXT DEFAULT 'manual',
  last_sync_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW()
);

-- 8. erp_integrations (-> providers)
CREATE TABLE IF NOT EXISTS erp_integrations (
  id SERIAL PRIMARY KEY,
  provider_id INTEGER NOT NULL REFERENCES providers(id),
  erp_source TEXT NOT NULL,
  is_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  status TEXT NOT NULL DEFAULT 'idle',
  total_synced INTEGER NOT NULL DEFAULT 0,
  total_errors INTEGER NOT NULL DEFAULT 0,
  last_sync_at TIMESTAMP,
  last_sync_status TEXT,
  notes TEXT,
  api_url TEXT,
  api_token TEXT,
  api_user TEXT,
  sync_interval_hours INTEGER NOT NULL DEFAULT 24,
  created_at TIMESTAMP DEFAULT NOW()
);

-- 9. erp_sync_logs (-> providers)
CREATE TABLE IF NOT EXISTS erp_sync_logs (
  id SERIAL PRIMARY KEY,
  provider_id INTEGER NOT NULL REFERENCES providers(id),
  erp_source TEXT NOT NULL,
  synced_at TIMESTAMP DEFAULT NOW(),
  upserted INTEGER NOT NULL DEFAULT 0,
  errors INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'success',
  ip_address TEXT,
  payload JSONB,
  sync_type TEXT NOT NULL DEFAULT 'manual',
  records_processed INTEGER NOT NULL DEFAULT 0,
  records_failed INTEGER NOT NULL DEFAULT 0
);

-- 10. contracts (-> customers, providers)
CREATE TABLE IF NOT EXISTS contracts (
  id SERIAL PRIMARY KEY,
  customer_id INTEGER NOT NULL REFERENCES customers(id),
  provider_id INTEGER NOT NULL REFERENCES providers(id),
  plan TEXT NOT NULL,
  value DECIMAL(10, 2) NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  start_date TIMESTAMP DEFAULT NOW(),
  end_date TIMESTAMP
);

-- 11. invoices (-> contracts, customers, providers)
CREATE TABLE IF NOT EXISTS invoices (
  id SERIAL PRIMARY KEY,
  contract_id INTEGER NOT NULL REFERENCES contracts(id),
  customer_id INTEGER NOT NULL REFERENCES customers(id),
  provider_id INTEGER NOT NULL REFERENCES providers(id),
  value DECIMAL(10, 2) NOT NULL,
  due_date TIMESTAMP NOT NULL,
  paid_date TIMESTAMP,
  status TEXT NOT NULL DEFAULT 'pending'
);

-- 12. equipment (-> customers, providers)
CREATE TABLE IF NOT EXISTS equipment (
  id SERIAL PRIMARY KEY,
  customer_id INTEGER REFERENCES customers(id),
  provider_id INTEGER NOT NULL REFERENCES providers(id),
  type TEXT NOT NULL,
  brand TEXT,
  model TEXT,
  serial_number TEXT,
  mac TEXT,
  status TEXT NOT NULL DEFAULT 'installed',
  in_recovery_process BOOLEAN DEFAULT FALSE,
  value DECIMAL(10, 2)
);

-- 13. isp_consultations (-> providers, users)
CREATE TABLE IF NOT EXISTS isp_consultations (
  id SERIAL PRIMARY KEY,
  provider_id INTEGER NOT NULL REFERENCES providers(id),
  user_id INTEGER NOT NULL REFERENCES users(id),
  cpf_cnpj TEXT NOT NULL,
  cpf_cnpj_hash TEXT,
  search_type TEXT NOT NULL,
  result JSONB,
  score INTEGER,
  decision_reco TEXT,
  cost INTEGER DEFAULT 1,
  approved BOOLEAN,
  created_at TIMESTAMP DEFAULT NOW()
);

-- 14. spc_consultations (-> providers, users)
CREATE TABLE IF NOT EXISTS spc_consultations (
  id SERIAL PRIMARY KEY,
  provider_id INTEGER NOT NULL REFERENCES providers(id),
  user_id INTEGER NOT NULL REFERENCES users(id),
  cpf_cnpj TEXT NOT NULL,
  result JSONB,
  score INTEGER,
  created_at TIMESTAMP DEFAULT NOW()
);

-- 15. support_threads (-> providers)
CREATE TABLE IF NOT EXISTS support_threads (
  id SERIAL PRIMARY KEY,
  provider_id INTEGER NOT NULL REFERENCES providers(id),
  subject TEXT NOT NULL DEFAULT 'Suporte Geral',
  status TEXT NOT NULL DEFAULT 'open',
  last_message_at TIMESTAMP DEFAULT NOW(),
  created_at TIMESTAMP DEFAULT NOW()
);

-- 16. support_messages (-> support_threads, users)
CREATE TABLE IF NOT EXISTS support_messages (
  id SERIAL PRIMARY KEY,
  thread_id INTEGER NOT NULL REFERENCES support_threads(id),
  sender_id INTEGER NOT NULL REFERENCES users(id),
  sender_name TEXT NOT NULL,
  content TEXT NOT NULL,
  is_from_admin BOOLEAN NOT NULL DEFAULT FALSE,
  is_read BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT NOW()
);

-- 17. plan_changes (-> providers, users)
CREATE TABLE IF NOT EXISTS plan_changes (
  id SERIAL PRIMARY KEY,
  provider_id INTEGER NOT NULL REFERENCES providers(id),
  old_plan TEXT,
  new_plan TEXT,
  isp_credits_added INTEGER DEFAULT 0,
  spc_credits_added INTEGER DEFAULT 0,
  changed_by_id INTEGER REFERENCES users(id),
  changed_by_name TEXT,
  notes TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

-- 18. anti_fraud_alerts (-> providers, customers)
CREATE TABLE IF NOT EXISTS anti_fraud_alerts (
  id SERIAL PRIMARY KEY,
  provider_id INTEGER NOT NULL REFERENCES providers(id),
  customer_id INTEGER REFERENCES customers(id),
  consulting_provider_id INTEGER REFERENCES providers(id),
  consulting_provider_name TEXT,
  customer_name TEXT,
  customer_cpf_cnpj TEXT,
  type TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT 'medium',
  message TEXT NOT NULL,
  risk_score INTEGER,
  risk_level TEXT DEFAULT 'low',
  risk_factors JSONB,
  days_overdue INTEGER DEFAULT 0,
  overdue_amount DECIMAL(10, 2) DEFAULT '0',
  equipment_not_returned INTEGER DEFAULT 0,
  equipment_value DECIMAL(10, 2) DEFAULT '0',
  recent_consultations INTEGER DEFAULT 0,
  resolved BOOLEAN NOT NULL DEFAULT FALSE,
  status TEXT NOT NULL DEFAULT 'new',
  created_at TIMESTAMP DEFAULT NOW()
);

-- 19. provider_invoices (-> providers, users)
CREATE TABLE IF NOT EXISTS provider_invoices (
  id SERIAL PRIMARY KEY,
  invoice_number TEXT NOT NULL UNIQUE,
  provider_id INTEGER NOT NULL REFERENCES providers(id),
  period TEXT NOT NULL,
  plan_at_time TEXT NOT NULL,
  amount DECIMAL(10, 2) NOT NULL,
  isp_credits_included INTEGER NOT NULL DEFAULT 0,
  spc_credits_included INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending',
  due_date TIMESTAMP NOT NULL,
  paid_date TIMESTAMP,
  paid_amount DECIMAL(10, 2),
  notes TEXT,
  created_by_id INTEGER REFERENCES users(id),
  created_by_name TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  asaas_charge_id TEXT,
  asaas_customer_id TEXT,
  asaas_status TEXT,
  asaas_invoice_url TEXT,
  asaas_bank_slip_url TEXT,
  asaas_pix_key TEXT,
  asaas_billing_type TEXT
);

-- 20. credit_orders (-> providers, users)
CREATE TABLE IF NOT EXISTS credit_orders (
  id SERIAL PRIMARY KEY,
  order_number TEXT NOT NULL UNIQUE,
  provider_id INTEGER NOT NULL REFERENCES providers(id),
  provider_name TEXT NOT NULL,
  package_name TEXT NOT NULL,
  isp_credits INTEGER NOT NULL DEFAULT 0,
  spc_credits INTEGER NOT NULL DEFAULT 0,
  amount DECIMAL(10, 2) NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  payment_method TEXT,
  asaas_charge_id TEXT,
  asaas_customer_id TEXT,
  asaas_status TEXT,
  asaas_invoice_url TEXT,
  asaas_bank_slip_url TEXT,
  asaas_pix_key TEXT,
  asaas_billing_type TEXT,
  credit_type TEXT NOT NULL DEFAULT 'mixed',
  credited_at TIMESTAMP,
  notes TEXT,
  created_by_id INTEGER REFERENCES users(id),
  created_by_name TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

-- 21. visitor_chat_messages (-> visitor_chats)
CREATE TABLE IF NOT EXISTS visitor_chat_messages (
  id SERIAL PRIMARY KEY,
  chat_id INTEGER NOT NULL REFERENCES visitor_chats(id),
  content TEXT NOT NULL,
  is_from_admin BOOLEAN NOT NULL DEFAULT FALSE,
  sender_name TEXT NOT NULL,
  is_read BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT NOW()
);

-- 22. titular_requests (-> users)
CREATE TABLE IF NOT EXISTS titular_requests (
  id SERIAL PRIMARY KEY,
  cpf_cnpj TEXT NOT NULL,
  nome TEXT NOT NULL,
  email TEXT NOT NULL,
  tipo_solicitacao TEXT NOT NULL,
  descricao TEXT,
  protocolo TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'pendente',
  prazo_limite TIMESTAMP,
  updated_by INTEGER REFERENCES users(id),
  updated_at TIMESTAMP,
  execution_result JSONB,
  created_at TIMESTAMP DEFAULT NOW()
);
