from datetime import datetime, timedelta, timezone
from pathlib import Path
import sqlite3

root = Path(__file__).resolve().parents[1]
db = sqlite3.connect(":memory:")
db.execute("PRAGMA foreign_keys = ON")

db.executescript((root / "migrations" / "0001_initial_schema.sql").read_text())
db.executescript((root / "migrations" / "0002_member_auth_and_conductors.sql").read_text())

columns = {row[1] for row in db.execute("PRAGMA table_info(users)")}
for required in {"login_code_hash", "pin_salt", "pin_hash"}:
    assert required in columns, f"Missing users column: {required}"

tables = {row[0] for row in db.execute(
    "SELECT name FROM sqlite_master WHERE type='table'"
)}
for required in {"auth_rate_limits", "access_reset_codes", "sessions", "choir_memberships"}:
    assert required in tables, f"Missing table: {required}"

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

fk_errors = list(db.execute("PRAGMA foreign_key_check"))
assert not fk_errors, f"Foreign key violations: {fk_errors}"

print("Schema/auth smoke test passed: migrations, FK-safe activation order, conductor role, and foreign keys.")
