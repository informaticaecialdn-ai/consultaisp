-- Spec 003 FR-016: Row-Level Security em todas as tabelas multi-tenant
-- App seta `app.current_provider_id` via SET LOCAL antes de cada transaction (FR-017)

-- Helper policy reutilizável
DO $$
DECLARE tbl TEXT;
BEGIN
  FOR tbl IN VALUES ('communications'), ('audit_logs'), ('compliance_checks'), ('agreements'), ('whatsapp_accounts'), ('whatsapp_optouts')
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', tbl);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', tbl);
    EXECUTE format($f$
      CREATE POLICY tenant_isolation ON %I
      USING (provider_id = current_setting('app.current_provider_id', true)::int)
      WITH CHECK (provider_id = current_setting('app.current_provider_id', true)::int)
    $f$, tbl);
  END LOOP;
END $$;

-- agent_memories: filtra por customer (que já é multi-tenant via providers)
ALTER TABLE agent_memories ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_via_customer ON agent_memories;
CREATE POLICY tenant_isolation_via_customer ON agent_memories
  USING (customer_id IN (
    SELECT id FROM customers WHERE provider_id = current_setting('app.current_provider_id', true)::int
  ));
