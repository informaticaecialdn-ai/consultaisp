CREATE TABLE IF NOT EXISTS chat_multicanal_config (
 provider_id integer NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
 conversation_id text NOT NULL,
 reply_token text NOT NULL UNIQUE,
 reforco_ativo boolean NOT NULL DEFAULT false,
 intervalo_horas integer NOT NULL DEFAULT 72 CHECK (intervalo_horas BETWEEN 24 AND 720),
 canais jsonb NOT NULL DEFAULT '["email"]',
 ultimo_reforco_em timestamptz,
 PRIMARY KEY(provider_id, conversation_id),
 FOREIGN KEY(provider_id, conversation_id) REFERENCES chat_bullq_conversas(provider_id, conversation_id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS chat_multicanal_mensagens (
 id bigserial PRIMARY KEY,
 provider_id integer NOT NULL,
 conversation_id text NOT NULL,
 canal text NOT NULL CHECK(canal IN ('sms','email')),
 direcao text NOT NULL CHECK(direcao IN ('entrada','saida')),
 texto text NOT NULL,
 assunto text,
 status text NOT NULL,
 chave text NOT NULL,
 external_id text,
 criado_em timestamptz NOT NULL DEFAULT now(),
 UNIQUE(provider_id, chave),
 FOREIGN KEY(provider_id, conversation_id) REFERENCES chat_bullq_conversas(provider_id, conversation_id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS chat_multicanal_retorno_unico ON chat_multicanal_mensagens(provider_id,canal,external_id) WHERE direcao='entrada';
CREATE INDEX IF NOT EXISTS chat_multicanal_historico ON chat_multicanal_mensagens(provider_id,conversation_id,criado_em);
