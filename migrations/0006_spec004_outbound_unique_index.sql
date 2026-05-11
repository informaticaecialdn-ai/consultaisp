-- Spec 004 — Idempotência da régua (FR-005)
-- UNIQUE com expressão (scheduled_for::date) que drizzle-kit não gera.
-- Garante: para a mesma (fatura, passo Bruno) só pode haver 1 tentativa por dia.
-- Aplica somente para steps Bruno (D-3/D-1); Sofia (THANK_YOU) não precisa
-- desta restrição porque a idempotência dela é em payment_events.

CREATE UNIQUE INDEX IF NOT EXISTS outbound_attempts_invoice_step_day_uq
  ON outbound_attempts (invoice_id, step, (scheduled_for::date))
  WHERE step IN ('D-3', 'D-1');
