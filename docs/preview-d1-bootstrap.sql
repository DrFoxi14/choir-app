-- ONE-TIME BOOTSTRAP FOR THE EMPTY PREVIEW DATABASE ONLY.
-- Target database ID: 490af251-9e3c-45cd-adc4-7ca41e6f633a
-- Never execute this against choir-app-db (production).
-- This combines the current 0001 and 0002 migrations and registers them.
-- Do not re-run on a partially initialized database.
PRAGMA foreign_keys = ON;

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS choirs (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'suspended')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS choir_domains (
  id TEXT PRIMARY KEY,
  choir_id TEXT NOT NULL REFERENCES choirs(id) ON DELETE CASCADE,
  hostname TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'active', 'disabled')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

INSERT OR IGNORE INTO choirs (id, name, slug)
VALUES ('choir_tabor', 'Corul Tabor', 'tabor');

-- A person has one account and can belong to more than one choir.
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  email_normalized TEXT UNIQUE,
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'suspended')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  login_code_hash TEXT,
  pin_salt TEXT,
  pin_hash TEXT
);

CREATE TABLE IF NOT EXISTS choir_memberships (
  id TEXT PRIMARY KEY,
  choir_id TEXT NOT NULL REFERENCES choirs(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'member'
    CHECK (role IN ('member', 'conductor', 'owner')),
  voice_part TEXT
    CHECK (voice_part IS NULL OR voice_part IN ('S', 'A', 'T', 'B')),
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('invited', 'active', 'suspended', 'removed')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (choir_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_memberships_user
  ON choir_memberships(user_id, status);
CREATE INDEX IF NOT EXISTS idx_memberships_choir
  ON choir_memberships(choir_id, status, role);

-- Store only a hash of each one-time activation code, never its plaintext.
CREATE TABLE IF NOT EXISTS activation_codes (
  id TEXT PRIMARY KEY,
  choir_id TEXT NOT NULL REFERENCES choirs(id) ON DELETE CASCADE,
  code_hash TEXT NOT NULL UNIQUE,
  intended_role TEXT NOT NULL DEFAULT 'member'
    CHECK (intended_role IN ('member', 'conductor')),
  voice_part TEXT
    CHECK (voice_part IS NULL OR voice_part IN ('S', 'A', 'T', 'B')),
  created_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  expires_at TEXT NOT NULL,
  used_at TEXT,
  used_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  revoked_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_activation_codes_choir
  ON activation_codes(choir_id, expires_at);

-- Store only hashes of opaque session tokens; never store bearer tokens in plaintext.
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  revoked_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_sessions_user
  ON sessions(user_id, expires_at);

CREATE TABLE IF NOT EXISTS songs (
  id TEXT PRIMARY KEY,
  choir_id TEXT NOT NULL REFERENCES choirs(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  slug TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'published', 'archived')),
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (choir_id, slug),
  UNIQUE (choir_id, id)
);

CREATE INDEX IF NOT EXISTS idx_songs_catalog
  ON songs(choir_id, status, sort_order, title);

CREATE TABLE IF NOT EXISTS song_assets (
  id TEXT PRIMARY KEY,
  choir_id TEXT NOT NULL,
  song_id TEXT NOT NULL,
  voice_part TEXT NOT NULL CHECK (voice_part IN ('S', 'A', 'T', 'B')),
  format TEXT NOT NULL CHECK (format IN ('pdf', 'audio', 'video')),
  object_key TEXT NOT NULL,
  content_type TEXT NOT NULL,
  size_bytes INTEGER CHECK (size_bytes IS NULL OR size_bytes >= 0),
  duration_seconds INTEGER CHECK (duration_seconds IS NULL OR duration_seconds >= 0),
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'published', 'archived')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  FOREIGN KEY (choir_id, song_id)
    REFERENCES songs(choir_id, id) ON DELETE CASCADE,
  UNIQUE (song_id, voice_part, format, object_key)
);

CREATE INDEX IF NOT EXISTS idx_song_assets_lookup
  ON song_assets(choir_id, song_id, voice_part, format, status);

CREATE TABLE IF NOT EXISTS audit_logs (
  id TEXT PRIMARY KEY,
  choir_id TEXT REFERENCES choirs(id) ON DELETE SET NULL,
  actor_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  target_type TEXT,
  target_id TEXT,
  metadata_json TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_choir_date
  ON audit_logs(choir_id, created_at DESC);

-- Credential columns are defined inline in users for this one-time Preview bootstrap.

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
-- Record these two migrations so Wrangler does not try to re-apply the SQL later.
CREATE TABLE IF NOT EXISTS d1_migrations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT UNIQUE,
  applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
);
INSERT OR IGNORE INTO d1_migrations (name)
VALUES ('0001_initial_schema.sql'), ('0002_member_auth_and_conductors.sql');

-- Verification: all expected tables and migration records should now exist.
SELECT name AS table_name
FROM sqlite_master
WHERE type = 'table'
  AND name IN (
    'choirs', 'choir_domains', 'users', 'choir_memberships',
    'activation_codes', 'sessions', 'songs', 'song_assets',
    'audit_logs', 'auth_rate_limits', 'access_reset_codes', 'd1_migrations'
  )
ORDER BY name;
SELECT id, name, applied_at FROM d1_migrations ORDER BY name;
