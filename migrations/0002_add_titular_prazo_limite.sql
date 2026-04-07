-- Migration: Add prazo_limite column to titular_requests
-- Required by: LGPD Art. 18 §5 — 15 business day deadline tracking
-- Date: 2026-04-07

ALTER TABLE titular_requests
  ADD COLUMN IF NOT EXISTS prazo_limite TIMESTAMP;

-- Backfill existing records: set prazo_limite to created_at + 21 calendar days (~15 business days)
UPDATE titular_requests
  SET prazo_limite = created_at + INTERVAL '21 days'
  WHERE prazo_limite IS NULL AND created_at IS NOT NULL;
