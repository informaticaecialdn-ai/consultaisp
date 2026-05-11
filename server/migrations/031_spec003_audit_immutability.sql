-- Spec 003: Trigger imutabilidade audit_logs (Princípio III não-negociável)
CREATE OR REPLACE FUNCTION raise_immutability_error() RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'audit_logs is append-only. UPDATE/DELETE blocked.';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS audit_logs_immutable_update ON audit_logs;
CREATE TRIGGER audit_logs_immutable_update
  BEFORE UPDATE ON audit_logs
  FOR EACH ROW EXECUTE FUNCTION raise_immutability_error();

DROP TRIGGER IF EXISTS audit_logs_immutable_delete ON audit_logs;
CREATE TRIGGER audit_logs_immutable_delete
  BEFORE DELETE ON audit_logs
  FOR EACH ROW EXECUTE FUNCTION raise_immutability_error();
