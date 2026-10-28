from pathlib import Path
import sqlite3

root = Path(__file__).resolve().parents[1]
db = sqlite3.connect(":memory:")
db.execute("PRAGMA foreign_keys = ON")
db.executescript((root / "docs" / "preview-d1-bootstrap.sql").read_text())

expected_tables = {
    "choirs", "choir_domains", "users", "choir_memberships",
    "activation_codes", "sessions", "songs", "song_assets",
    "audit_logs", "auth_rate_limits", "access_reset_codes", "d1_migrations",
}
tables = {row[0] for row in db.execute(
    "SELECT name FROM sqlite_master WHERE type = 'table'"
)}
missing = expected_tables - tables
assert not missing, f"Missing Preview tables: {sorted(missing)}"

user_columns = {row[1] for row in db.execute("PRAGMA table_info(users)")}
assert {"login_code_hash", "pin_salt", "pin_hash"} <= user_columns, (
    "Preview user authentication columns are missing"
)

migration_names = {row[0] for row in db.execute("SELECT name FROM d1_migrations")}
assert migration_names == {
    "0001_initial_schema.sql", "0002_member_auth_and_conductors.sql"
}, f"Unexpected migration records: {migration_names}"

indexes = {row[1] for row in db.execute("PRAGMA index_list(users)")}
assert "idx_users_login_code_hash" in indexes, "Missing unique login-code hash index"

tabor = db.execute(
    "SELECT name, slug, status FROM choirs WHERE id='choir_tabor'"
).fetchone()
assert tabor == ("Corul Tabor", "tabor", "active"), f"Unexpected seeded choir: {tabor}"

fk_errors = list(db.execute("PRAGMA foreign_key_check"))
assert not fk_errors, f"Foreign key violations: {fk_errors}"

print("Preview D1 bootstrap passed: complete schema, auth fields, migration records, seed choir, and foreign keys.")
