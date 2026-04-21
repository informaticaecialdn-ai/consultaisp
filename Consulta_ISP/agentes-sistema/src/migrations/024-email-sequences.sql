-- Email sequence de nurturing (Sofia).
-- Sequencia de emails espacados enviados pra lead em nurturing (frio/morno
-- que pediu "volta depois"). Estado persiste entre envios pra reengajar.

CREATE TABLE IF NOT EXISTS email_sequences (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  lead_id INTEGER NOT NULL,
  sequence_type TEXT NOT NULL,            -- 'nurturing','reengagement','onboarding'
  step_atual INTEGER DEFAULT 0,           -- proximo step a enviar (0-based)
  total_steps INTEGER NOT NULL,
  status TEXT DEFAULT 'ativa'
    CHECK(status IN ('ativa','pausada','concluida','optout','completada')),
  ultimo_enviado_em DATETIME,
  proximo_envio_em DATETIME,              -- quando enviar proximo
  criada_por_agente TEXT DEFAULT 'sofia',
  criada_em DATETIME DEFAULT CURRENT_TIMESTAMP,
  atualizada_em DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (lead_id) REFERENCES leads(id)
);

CREATE INDEX IF NOT EXISTS idx_email_seq_status ON email_sequences(status);
CREATE INDEX IF NOT EXISTS idx_email_seq_proximo ON email_sequences(proximo_envio_em);
CREATE INDEX IF NOT EXISTS idx_email_seq_lead ON email_sequences(lead_id);

CREATE TABLE IF NOT EXISTS email_sequence_sends (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sequence_id INTEGER NOT NULL,
  lead_id INTEGER NOT NULL,
  step INTEGER NOT NULL,
  subject TEXT,
  body_preview TEXT,                      -- primeiras 200 chars
  resend_id TEXT,                         -- ID retornado pelo Resend
  status TEXT DEFAULT 'sent'
    CHECK(status IN ('sent','delivered','opened','clicked','bounced','failed')),
  sent_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  error TEXT,
  FOREIGN KEY (sequence_id) REFERENCES email_sequences(id),
  FOREIGN KEY (lead_id) REFERENCES leads(id)
);

CREATE INDEX IF NOT EXISTS idx_email_sends_seq ON email_sequence_sends(sequence_id);
