-- Credentials are salted PIN hashes and hashes of generated account codes only.
ALTER TABLE users ADD COLUMN login_code_hash TEXT;
ALTER TABLE users ADD COLUMN pin_salt TEXT;
ALTER TABLE users ADD COLUMN pin_hash TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_login_code_hash
  ON users(login_code_hash) WHERE login_code_hash IS NOT NULL;

-- HMAC identifiers are stored instead of raw client IP addresses or account codes.
CREATE TABLE IF NOT EXISTS auth_rate_limits (
  key_hash TEXT NOT NULL,
  action TEXT NOT NULL,
  window_started_at INTEGER NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  PRIMARY KEY (key_hash, action)
);

CREATE INDEX IF NOT EXISTS idx_auth_rate_limits_window
  ON auth_rate_limits(window_started_at);

-- One-time conductor-issued PIN reset codes; plaintext is never stored.
CREATE TABLE IF NOT EXISTS access_reset_codes (
  id TEXT PRIMARY KEY,
  choir_id TEXT NOT NULL REFERENCES choirs(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  code_hash TEXT NOT NULL UNIQUE,
  created_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  expires_at TEXT NOT NULL,
  used_at TEXT,
  used_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  revoked_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_access_reset_codes_user
  ON access_reset_codes(choir_id, user_id, expires_at);
