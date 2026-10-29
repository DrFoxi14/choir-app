from datetime import datetime, timedelta, timezone
from pathlib import Path
import sqlite3

root = Path(__file__).resolve().parents[1]
db = sqlite3.connect(":memory:")
db.execute("PRAGMA foreign_keys = ON")

db.executescript((root / "migrations" / "0001_initial_schema.sql").read_text())
db.executescript((root / "migrations" / "0002_member_auth_and_conductors.sql").read_text())
db.executescript((root / "migrations" / "0003_member_phone_verification.sql").read_text())
db.executescript((root / "migrations" / "0004_preferences_attendance.sql").read_text())
db.executescript((root / "migrations" / "0005_backblaze_media.sql").read_text())

columns = {row[1] for row in db.execute("PRAGMA table_info(users)")}
for required in {"login_code_hash", "pin_salt", "pin_hash"}:
    assert required in columns, f"Missing users column: {required}"

tables = {row[0] for row in db.execute(
    "SELECT name FROM sqlite_master WHERE type='table'"
)}
for required in {"auth_rate_limits", "access_reset_codes", "sessions", "choir_memberships", "user_preferences", "attendance_sessions", "attendance_records", "media_uploads"}:
    assert required in tables, f"Missing table: {required}"


# Backblaze upload reservations must be scoped to an existing choir song and creator.
media_columns = {row[1] for row in db.execute("PRAGMA table_info(media_uploads)")}
for required in {"id", "choir_id", "song_id", "created_by_user_id", "object_key", "voice_part", "format", "file_name", "content_type", "size_bytes", "status", "expires_at"}:
    assert required in media_columns, f"Missing media_uploads column: {required}"
asset_columns = {row[1] for row in db.execute("PRAGMA table_info(song_assets)")}
assert "file_name" in asset_columns, "Uploaded file labels must be stored separately from storage keys"

tabor = db.execute("SELECT name, slug, status FROM choirs WHERE id='choir_tabor'").fetchone()
assert tabor == ("Corul Tabor", "tabor", "active"), f"Unexpected seeded choir: {tabor}"

indexes = {row[1] for row in db.execute("PRAGMA index_list(users)")}
assert "idx_users_login_code_hash" in indexes, "Login-code hashes must be unique"

now = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
expires = (datetime.now(timezone.utc) + timedelta(days=7)).isoformat().replace("+00:00", "Z")
db.execute(
    "INSERT INTO users (id, display_name, login_code_hash, pin_salt, pin_hash) "
    "VALUES ('owner-user', 'Owner Test', 'owner-login-hash', 'salt', 'pin-hash')"
)
db.execute(
    "INSERT INTO choir_memberships (id, choir_id, user_id, role, status) "
    "VALUES ('owner-membership', 'choir_tabor', 'owner-user', 'owner', 'active')"
)
db.execute(
    "INSERT INTO activation_codes (id, choir_id, code_hash, intended_role, voice_part, "
    "created_by_user_id, expires_at) VALUES (?, 'choir_tabor', ?, 'conductor', NULL, 'owner-user', ?)",
    ("conductor-invite", "conductor-code-hash", expires),
)

# The old ordering must fail: used_by_user_id is a foreign key and the user
# doesn't exist yet. This test protects the corrected insert-then-claim order.
try:
    db.execute(
        "UPDATE activation_codes SET used_at = ?, used_by_user_id = ? WHERE id = ?",
        (now, "new-conductor", "conductor-invite"),
    )
except sqlite3.IntegrityError:
    pass
else:
    raise AssertionError("Activation code must not reference a user that does not exist")

# Correct flow: insert the invited user while the code is valid, then claim it.
db.execute(
    "INSERT INTO users (id, display_name, login_code_hash, pin_salt, pin_hash) "
    "SELECT ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM activation_codes "
    "WHERE id = ? AND code_hash = ? AND choir_id = ? AND used_at IS NULL "
    "AND revoked_at IS NULL AND expires_at > ?)",
    ("new-conductor", "Conductor Test", "conductor-login-hash", "salt2", "pin-hash2",
     "conductor-invite", "conductor-code-hash", "choir_tabor", now),
)
assert db.execute("SELECT changes()").fetchone()[0] == 1, "Valid activation did not create the user"
db.execute(
    "UPDATE activation_codes SET used_at = ?, used_by_user_id = ? "
    "WHERE id = ? AND code_hash = ? AND choir_id = ? AND used_at IS NULL "
    "AND revoked_at IS NULL AND expires_at > ? AND EXISTS "
    "(SELECT 1 FROM users WHERE id = ?)",
    (now, "new-conductor", "conductor-invite", "conductor-code-hash",
     "choir_tabor", now, "new-conductor"),
)
assert db.execute("SELECT changes()").fetchone()[0] == 1, "Valid activation code was not claimed"
db.execute(
    "INSERT INTO choir_memberships (id, choir_id, user_id, role, voice_part, status) "
    "SELECT ?, a.choir_id, ?, a.intended_role, a.voice_part, 'active' FROM activation_codes a "
    "WHERE a.id = ? AND a.used_by_user_id = ? AND EXISTS "
    "(SELECT 1 FROM users WHERE id = ?)",
    ("conductor-membership", "new-conductor", "conductor-invite", "new-conductor", "new-conductor"),
)
assert db.execute("SELECT changes()").fetchone()[0] == 1, "Conductor membership was not created"
membership = db.execute(
    "SELECT role, voice_part FROM choir_memberships WHERE user_id='new-conductor'"
).fetchone()
assert membership == ("conductor", None), f"Wrong conductor role/voice: {membership}"

verification_columns = {row[1] for row in db.execute("PRAGMA table_info(choir_memberships)")}
for required in {"phone_verified_at", "phone_verified_by_user_id"}:
    assert required in verification_columns, f"Missing membership verification column: {required}"

db.execute(
    "UPDATE choir_memberships SET phone_verified_at = ?, phone_verified_by_user_id = ? "
    "WHERE choir_id = 'choir_tabor' AND user_id = 'new-conductor'",
    (now, "owner-user"),
)
verification = db.execute(
    "SELECT phone_verified_at, phone_verified_by_user_id FROM choir_memberships WHERE user_id='new-conductor'"
).fetchone()
assert verification == (now, "owner-user"), f"Phone verification persistence failed: {verification}"

# A saved theme and attendance session/record must persist under the new schema.
db.execute(
    "INSERT INTO user_preferences (user_id, accent_theme) VALUES ('owner-user', 'violet')"
)
theme = db.execute(
    "SELECT accent_theme FROM user_preferences WHERE user_id='owner-user'"
).fetchone()
assert theme == ("violet",), f"Theme preference persistence failed: {theme}"
try:
    db.execute(
        "INSERT INTO user_preferences (user_id, accent_theme) VALUES ('new-conductor', 'not-a-theme')"
    )
except sqlite3.IntegrityError:
    pass
else:
    raise AssertionError("Unknown theme must be rejected by the database constraint")

db.execute(
    "INSERT INTO attendance_sessions (id, choir_id, session_date, title, created_by_user_id) "
    "VALUES ('att-session-test', 'choir_tabor', '2026-10-28', 'Repetiție', 'owner-user')"
)
db.execute(
    "INSERT INTO attendance_records (id, session_id, membership_id, status, recorded_by_user_id) "
    "VALUES ('att-record-test', 'att-session-test', 'owner-membership', 'present', 'owner-user')"
)
attendance = db.execute(
    "SELECT s.session_date, r.status FROM attendance_sessions s "
    "JOIN attendance_records r ON r.session_id=s.id WHERE r.id='att-record-test'"
).fetchone()
assert attendance == ("2026-10-28", "present"), f"Attendance persistence failed: {attendance}"
try:
    db.execute(
        "INSERT INTO attendance_records (id, session_id, membership_id, status) "
        "VALUES ('bad-status-test', 'att-session-test', 'conductor-membership', 'maybe')"
    )
except sqlite3.IntegrityError:
    pass
else:
    raise AssertionError("Unknown attendance status must be rejected by the database constraint")

# Legal acknowledgements are stored as auditable, versioned events without a new schema table.
legal_metadata = '{"termsVersion":"2026-10-28-v1","privacyVersion":"2026-10-28-v1","acceptedVia":"account_activation"}'
db.execute(
    "INSERT INTO audit_logs (id, choir_id, actor_user_id, action, target_type, target_id, metadata_json) "
    "VALUES (?, 'choir_tabor', 'new-conductor', 'legal.terms.accepted', 'user', 'new-conductor', ?)",
    ("legal-acceptance-test", legal_metadata),
)
recorded_versions = db.execute(
    "SELECT json_extract(metadata_json, '$.termsVersion'), json_extract(metadata_json, '$.privacyVersion') "
    "FROM audit_logs WHERE action='legal.terms.accepted' AND target_id='new-conductor'"
).fetchone()
assert recorded_versions == ("2026-10-28-v1", "2026-10-28-v1"), (
    f"Legal acceptance versions were not recorded correctly: {recorded_versions}"
)

fk_errors = list(db.execute("PRAGMA foreign_key_check"))
assert not fk_errors, f"Foreign key violations: {fk_errors}"

print("Schema/auth smoke test passed: migrations, FK-safe activation order, conductor role, and foreign keys.")
