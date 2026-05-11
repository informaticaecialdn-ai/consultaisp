# server/audit/

**Audit log imutável — defesa jurídica em Procon/Anatel/Justiça.**

Estrutura:
- `audit-log.ts` — helpers para `registrarAcao()`, `gerarDossie()` (defesa Procon em <30s)
- `triggers.sql` — triggers Postgres que BLOQUEIAM UPDATE/DELETE na tabela `audit_log`

**Princípio NÃO-NEGOCIÁVEL (CLAUDE.md §3.3):** triggers Postgres garantem que registros de audit_log são append-only. Mesmo `service_role` ou admin não consegue alterar. Qualquer tentativa = erro raise no SQL.

**Schema mínimo (a adicionar via migration):**

```sql
CREATE TABLE audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id INTEGER NOT NULL REFERENCES providers(id),
  action VARCHAR NOT NULL,        -- ex: 'send_whatsapp_cobranca'
  resource VARCHAR NOT NULL,      -- ex: 'Customer'
  resource_id VARCHAR NOT NULL,
  actor_type VARCHAR NOT NULL,    -- 'AGENT' | 'HUMAN' | 'SYSTEM'
  actor_id VARCHAR NOT NULL,      -- ex: 'agt_negociador_v1'
  actor_name VARCHAR NOT NULL,    -- ex: 'Rafael - Negociador'
  payload JSONB,                  -- dados completos
  legal_basis TEXT NOT NULL,      -- ex: 'Execução de contrato (LGPD art. 7º V)'
  legal_references TEXT[],        -- ['CDC art. 71', 'Anatel 765/2023']
  notification_proof JSONB,       -- { whatsappMessageId, deliveredAt, readAt }
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  INDEX (tenant_id, occurred_at DESC),
  INDEX (tenant_id, resource, resource_id)
);

CREATE TRIGGER audit_log_immutable
  BEFORE UPDATE OR DELETE ON audit_log
  FOR EACH ROW EXECUTE FUNCTION raise_immutability_error();
```

Retenção: 5 anos mínimo (defesa em juízo). Particionamento por mês recomendado a partir de 1M+ registros.
