-- Recebimentos explícitos e pré-avisos por fatura/dia. Sem inferir pagamentos legados.
CREATE TABLE IF NOT EXISTS cobranca_quitacoes (
  id serial PRIMARY KEY,
  provider_id integer NOT NULL REFERENCES providers(id),
  customer_id integer NOT NULL REFERENCES customers(id),
  fatura_id integer NOT NULL REFERENCES invoices(id),
  origem text NOT NULL CHECK (origem IN ('erp_confirmado', 'comprovante_conferido')),
  referencia text NOT NULL,
  pago_em date NOT NULL,
  valor_pago numeric(12,2) NOT NULL CHECK (valor_pago > 0),
  user_id integer REFERENCES users(id),
  confirmado_em timestamp NOT NULL DEFAULT now(),
  divergencia_erp_em timestamp,
  CHECK (origem <> 'comprovante_conferido' OR user_id IS NOT NULL)
);
CREATE UNIQUE INDEX IF NOT EXISTS cobranca_quitacoes_fatura_uq ON cobranca_quitacoes(provider_id, fatura_id);
CREATE UNIQUE INDEX IF NOT EXISTS cobranca_quitacoes_referencia_uq ON cobranca_quitacoes(provider_id, origem, referencia);
CREATE TABLE IF NOT EXISTS cobranca_pre_avisos (
  id serial PRIMARY KEY,
  provider_id integer NOT NULL REFERENCES providers(id),
  customer_id integer NOT NULL REFERENCES customers(id),
  fatura_id integer NOT NULL REFERENCES invoices(id),
  dia_contato date NOT NULL,
  vencimento date NOT NULL,
  dias_atraso integer NOT NULL CHECK (dias_atraso IN (-7, -3, -1)),
  status text NOT NULL DEFAULT 'pendente' CHECK (status IN ('pendente', 'enviando', 'enviado', 'ignorado', 'incerto')),
  motivo text,
  conversation_id text,
  message_id text,
  atualizado_em timestamp NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS cobranca_pre_avisos_fatura_dia_uq ON cobranca_pre_avisos(provider_id, fatura_id, dia_contato);
CREATE INDEX IF NOT EXISTS cobranca_pre_avisos_fila_idx ON cobranca_pre_avisos(provider_id, dia_contato, status);
