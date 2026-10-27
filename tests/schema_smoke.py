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

fk_errors = list(db.execute("PRAGMA foreign_key_check"))
assert not fk_errors, f"Foreign key violations: {fk_errors}"

print("Schema smoke test passed: base schema + auth migration + foreign keys.")
