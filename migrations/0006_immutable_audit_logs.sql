-- Audit records are append-only. No application action or FK operation may edit/delete them.
CREATE TRIGGER IF NOT EXISTS audit_logs_block_update
BEFORE UPDATE ON audit_logs
BEGIN
  SELECT RAISE(ABORT, 'audit_logs are immutable');
END;

CREATE TRIGGER IF NOT EXISTS audit_logs_block_delete
BEFORE DELETE ON audit_logs
BEGIN
  SELECT RAISE(ABORT, 'audit_logs are immutable');
END;
