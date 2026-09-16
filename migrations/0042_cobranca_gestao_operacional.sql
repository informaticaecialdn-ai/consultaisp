CREATE TABLE IF NOT EXISTS cobranca_gestao_config (
 provider_id integer PRIMARY KEY REFERENCES providers(id), config jsonb NOT NULL DEFAULT '{}', updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS cobranca_contestacoes (
 id serial PRIMARY KEY, provider_id integer NOT NULL REFERENCES providers(id), customer_id integer NOT NULL REFERENCES customers(id),
 fatura_id integer NOT NULL REFERENCES invoices(id), motivo text NOT NULL CHECK(motivo IN ('valor','pagamento','servico','duplicidade','titularidade','outro')),
 relato text NOT NULL, evidencia text NOT NULL DEFAULT '', responsavel_id integer NOT NULL REFERENCES users(id), prazo date NOT NULL,
 status text NOT NULL DEFAULT 'aberta' CHECK(status IN ('aberta','procedente','improcedente','cancelada')),
 criado_por integer NOT NULL REFERENCES users(id), criado_em timestamptz NOT NULL DEFAULT now(), resolvido_por integer REFERENCES users(id), resolvido_em timestamptz, justificativa text,
 CHECK ((status='aberta' AND resolvido_em IS NULL) OR (status<>'aberta' AND resolvido_em IS NOT NULL AND resolvido_por IS NOT NULL AND justificativa IS NOT NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS cobranca_contestacao_aberta ON cobranca_contestacoes(provider_id,fatura_id) WHERE status='aberta';
CREATE INDEX IF NOT EXISTS cobranca_contestacao_cliente ON cobranca_contestacoes(provider_id,customer_id,status);
CREATE TABLE IF NOT EXISTS cobranca_contatos_orcamento (
 id bigserial PRIMARY KEY, provider_id integer NOT NULL REFERENCES providers(id), customer_id integer NOT NULL REFERENCES customers(id),
 canal text NOT NULL CHECK(canal IN ('whatsapp','sms','email')), automatico boolean NOT NULL,
 chave text NOT NULL, status text NOT NULL DEFAULT 'reservado' CHECK(status IN ('reservado','enviado','falhou','incerto')),
 criado_em timestamptz NOT NULL DEFAULT now(), atualizado_em timestamptz NOT NULL DEFAULT now(), UNIQUE(provider_id,chave)
);
CREATE INDEX IF NOT EXISTS cobranca_orcamento_cliente ON cobranca_contatos_orcamento(provider_id,customer_id,criado_em DESC);
