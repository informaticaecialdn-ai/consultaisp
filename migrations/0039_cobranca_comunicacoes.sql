CREATE TABLE IF NOT EXISTS cobranca_avisos_config (
  provider_id integer PRIMARY KEY REFERENCES providers(id),
  config jsonb NOT NULL DEFAULT '{}',
  updated_at timestamp NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS cobranca_comunicacao_config (
  provider_id integer PRIMARY KEY REFERENCES providers(id),
  config jsonb NOT NULL DEFAULT '{}',
  updated_at timestamp NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS cobranca_preferencias_contato (
  provider_id integer NOT NULL REFERENCES providers(id),
  customer_id integer NOT NULL REFERENCES customers(id),
  nao_contatar boolean NOT NULL DEFAULT false,
  pausa_ate timestamp,
  motivo text,
  user_id integer REFERENCES users(id),
  updated_at timestamp NOT NULL DEFAULT now(),
  PRIMARY KEY(provider_id, customer_id)
);
CREATE TABLE IF NOT EXISTS cobranca_comunicacoes (
  id serial PRIMARY KEY,
  provider_id integer NOT NULL REFERENCES providers(id),
  customer_id integer NOT NULL REFERENCES customers(id),
  caso_id integer REFERENCES cobranca_casos(id),
  fatura_id integer REFERENCES invoices(id),
  canal text NOT NULL CHECK(canal IN ('sms','email','whatsapp')),
  finalidade text NOT NULL CHECK(finalidade IN ('cobranca','preventivo')),
  chave text NOT NULL,
  dia date NOT NULL,
  status text NOT NULL CHECK(status IN ('enviando','enviado','falhou','incerto','ignorado')),
  motivo text,
  provider_message_id text,
  criado_em timestamp NOT NULL DEFAULT now(),
  atualizado_em timestamp NOT NULL DEFAULT now(),
  UNIQUE(provider_id,chave),
  UNIQUE(provider_id,customer_id,dia)
);
CREATE INDEX IF NOT EXISTS cobranca_comunicacoes_diario_idx ON cobranca_comunicacoes(provider_id,criado_em DESC);
CREATE INDEX IF NOT EXISTS cobranca_comunicacoes_cliente_idx ON cobranca_comunicacoes(provider_id,customer_id,criado_em DESC);
CREATE INDEX IF NOT EXISTS cobranca_pre_avisos_cliente_idx ON cobranca_pre_avisos(provider_id,customer_id,atualizado_em DESC);
