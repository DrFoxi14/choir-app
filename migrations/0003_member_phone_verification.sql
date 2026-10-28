-- Phone verification is a choir-specific decision made by a conductor after confirming the number.
-- A phone number change clears verification across all choir memberships in application code.
ALTER TABLE choir_memberships ADD COLUMN phone_verified_at TEXT;
ALTER TABLE choir_memberships ADD COLUMN phone_verified_by_user_id TEXT
  REFERENCES users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_memberships_phone_verification
  ON choir_memberships(choir_id, phone_verified_at);
