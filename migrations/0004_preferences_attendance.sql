-- User-controlled visual preference; the allowlist is enforced by the CHECK constraint.
CREATE TABLE IF NOT EXISTS user_preferences (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  accent_theme TEXT NOT NULL DEFAULT 'ocean'
    CHECK (accent_theme IN ('ocean', 'violet', 'emerald', 'rose', 'amber', 'teal', 'slate', 'berry')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- Attendance is structured relational data. No files or object-storage bucket are needed.
CREATE TABLE IF NOT EXISTS attendance_sessions (
  id TEXT PRIMARY KEY,
  choir_id TEXT NOT NULL REFERENCES choirs(id) ON DELETE CASCADE,
  session_date TEXT NOT NULL CHECK (length(session_date) = 10),
  title TEXT NOT NULL DEFAULT 'Repetiție' CHECK (length(title) BETWEEN 1 AND 80),
  created_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (choir_id, session_date, title),
  UNIQUE (choir_id, id)
);

CREATE INDEX IF NOT EXISTS idx_attendance_sessions_date
  ON attendance_sessions(choir_id, session_date);

CREATE TABLE IF NOT EXISTS attendance_records (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES attendance_sessions(id) ON DELETE CASCADE,
  membership_id TEXT NOT NULL REFERENCES choir_memberships(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('present', 'absent', 'excused', 'late')),
  recorded_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (session_id, membership_id)
);

CREATE INDEX IF NOT EXISTS idx_attendance_records_session
  ON attendance_records(session_id, membership_id);
