-- Spec 004 — Backfill agent_toggles para providers existentes
-- Defaults (todos OFF) garantem que nenhum provedor recebe régua automática
-- sem opt-in explícito via UI (FR-013).

INSERT INTO agent_toggles (provider_id)
SELECT id FROM providers
ON CONFLICT (provider_id) DO NOTHING;
