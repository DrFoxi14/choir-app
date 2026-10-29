-- Backblaze B2 media storage: one-time upload reservations and uploaded-file labels.
ALTER TABLE song_assets ADD COLUMN file_name TEXT;

CREATE TABLE IF NOT EXISTS media_uploads (
  id TEXT PRIMARY KEY,
  choir_id TEXT NOT NULL,
  song_id TEXT NOT NULL,
  created_by_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  object_key TEXT NOT NULL UNIQUE,
  voice_part TEXT NOT NULL CHECK (voice_part IN ('S', 'A', 'T', 'B')),
  format TEXT NOT NULL CHECK (format IN ('pdf', 'audio', 'video')),
  file_name TEXT NOT NULL CHECK (length(file_name) BETWEEN 1 AND 180),
  content_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL CHECK (size_bytes > 0),
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'completed', 'expired')),
  expires_at TEXT NOT NULL,
  completed_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  FOREIGN KEY (choir_id, song_id)
    REFERENCES songs(choir_id, id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_media_uploads_pending
  ON media_uploads(choir_id, created_by_user_id, status, expires_at);

CREATE INDEX IF NOT EXISTS idx_song_assets_filename
  ON song_assets(choir_id, song_id, status);
