-- Confissão de dívida (CPC 784) com assinatura eletrônica via ZapSign
-- (desenho aprovado pelo dono em 09/09/2026, spec
-- docs/superpowers/specs/2026-09-09-confissao-de-divida-zapsign-design.md).
--
--   assinatura_integracoes   a conta ZapSign de cada provedor (token cifrado
--                            pelo servidor; webhook_secret autentica o retorno)
--   cobranca_confissoes      a confissão: foto canônica da dívida + hash,
--                            Anexo I lido do ERP ao vivo, documento e
--                            signatários no ZapSign, máquina de estados
--   cobranca_confissoes_pdf  os bytes (original e assinado), fora da linha
--
-- Sem BEGIN/COMMIT: o runner (server/migrate.ts) envolve cada arquivo numa
-- transacao — um COMMIT aqui fecharia a dele e o ROLLBACK nao desfaria nada.
CREATE TABLE IF NOT EXISTS assinatura_integracoes (
  id serial PRIMARY KEY,
  provider_id integer NOT NULL REFERENCES providers(id),
  fornecedor text NOT NULL DEFAULT 'zapsign',
  api_token text,
  ambiente text NOT NULL DEFAULT 'sandbox',
  template_id text,
  signatario_nome text,
  signatario_cpf text,
  signatario_email text,
  signatario_telefone text,
  provedor_assina boolean NOT NULL DEFAULT false,
  auth_mode_cliente text NOT NULL DEFAULT 'assinaturaTela-tokenWhatsapp',
  exigir_selfie boolean NOT NULL DEFAULT false,
  prazo_assinatura_dias integer NOT NULL DEFAULT 15,
  enviar_arquivo_assinado_whatsapp boolean NOT NULL DEFAULT false,
  modelo_revisado_em timestamp,
  modelo_revisado_por_user_id integer REFERENCES users(id),
  webhook_secret text,
  is_enabled boolean NOT NULL DEFAULT false,
  ativada_em timestamp,
  created_at timestamp DEFAULT now(),
  updated_at timestamp DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS assinatura_integracoes_provider_fornecedor
  ON assinatura_integracoes (provider_id, fornecedor);

CREATE TABLE IF NOT EXISTS cobranca_confissoes (
  id serial PRIMARY KEY,
  provider_id integer NOT NULL REFERENCES providers(id),
  customer_id integer NOT NULL REFERENCES customers(id),
  caso_id integer NOT NULL REFERENCES cobranca_casos(id),
  negociacao_id integer REFERENCES cobranca_negociacoes(id),
  origem text NOT NULL,
  ambiente text NOT NULL,
  zapsign_sandbox boolean,
  valor_total numeric(12,2) NOT NULL,
  valor_original numeric(12,2),
  desconto_pct numeric(5,2),
  parcelas jsonb NOT NULL DEFAULT '[]'::jsonb,
  erp_source text,
  erp_lido_em timestamp,
  erp_faturas jsonb NOT NULL DEFAULT '[]'::jsonb,
  modelo text NOT NULL DEFAULT 'padrao',
  modelo_versao text NOT NULL,
  modelo_revisado boolean NOT NULL DEFAULT false,
  base_canonica jsonb NOT NULL,
  texto_hash text NOT NULL,
  gerado_em timestamp NOT NULL,
  status text NOT NULL DEFAULT 'rascunho',
  recusa_informada_em timestamp,
  expiracao_informada_em timestamp,
  reconciliar_em timestamp,
  zapsign_doc_token text,
  webhook_zapsign_id text,
  zapsign_signers jsonb NOT NULL DEFAULT '[]'::jsonb,
  cliente_nome text,
  cliente_cpf_cnpj text,
  cliente_email text,
  cliente_telefone text,
  cliente_email_erp text,
  cliente_telefone_erp text,
  contato_alterado_por_user_id integer REFERENCES users(id),
  representante_nome text,
  representante_cpf text,
  data_limite_assinatura date NOT NULL,
  enviada_em timestamp,
  assinada_em timestamp,
  encerrada_em timestamp,
  pdf_original_sha256 text,
  pdf_assinado_sha256 text,
  criada_por_user_id integer NOT NULL REFERENCES users(id),
  aprovada_por_user_id integer REFERENCES users(id),
  chave_idempotencia uuid,
  erro_ultimo text,
  created_at timestamp DEFAULT now(),
  updated_at timestamp DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_cobranca_confissoes_cliente ON cobranca_confissoes (provider_id, customer_id);
CREATE INDEX IF NOT EXISTS idx_cobranca_confissoes_status ON cobranca_confissoes (provider_id, status);
CREATE INDEX IF NOT EXISTS idx_cobranca_confissoes_reconciliar ON cobranca_confissoes (status, reconciliar_em);
CREATE UNIQUE INDEX IF NOT EXISTS cobranca_confissoes_doc_token_uq
  ON cobranca_confissoes (zapsign_doc_token) WHERE zapsign_doc_token IS NOT NULL;
-- Uma confissao VIVA por cliente: emitir outra exige cancelar a existente.
CREATE UNIQUE INDEX IF NOT EXISTS cobranca_confissoes_viva_uq
  ON cobranca_confissoes (provider_id, customer_id) WHERE status IN ('rascunho', 'enviada');
CREATE UNIQUE INDEX IF NOT EXISTS cobranca_confissoes_idempotencia_uq
  ON cobranca_confissoes (provider_id, chave_idempotencia) WHERE chave_idempotencia IS NOT NULL;

CREATE TABLE IF NOT EXISTS cobranca_confissoes_pdf (
  confissao_id integer NOT NULL REFERENCES cobranca_confissoes(id),
  provider_id integer NOT NULL REFERENCES providers(id),
  tipo text NOT NULL,
  sha256 text NOT NULL,
  tamanho_bytes integer NOT NULL,
  base64 text NOT NULL,
  baixado_em timestamp,
  created_at timestamp DEFAULT now(),
  PRIMARY KEY (confissao_id, tipo)
);
