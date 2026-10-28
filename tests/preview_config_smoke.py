from pathlib import Path
import tomllib

root = Path(__file__).resolve().parents[1]
config = tomllib.loads((root / "wrangler.toml").read_text())

production = config.get("d1_databases", [])
previews = config.get("previews", {})
preview_d1 = previews.get("d1_databases", [])

assert len(production) == 1, f"Expected one production D1 binding, got {len(production)}"
assert len(preview_d1) == 1, f"Expected one Preview D1 binding, got {len(preview_d1)}"

prod_db = production[0]
preview_db = preview_d1[0]

assert prod_db.get("binding") == "DB", "Production D1 binding must be DB"
assert preview_db.get("binding") == prod_db.get("binding") == "DB", (
    "Preview must expose the same DB binding name"
)
assert prod_db.get("database_id"), "Production D1 database_id is missing"
assert preview_db.get("database_id"), "Preview D1 database_id is missing"
assert preview_db["database_id"] != prod_db["database_id"], (
    "Preview D1 must be isolated from production D1"
)
assert preview_db.get("database_name") == "choir-app-preview", (
    "Unexpected Preview D1 database name"
)
assert preview_db.get("migrations_dir") == config.get("d1_databases", [{}])[0].get("migrations_dir"), (
    "Preview D1 must use the repository migrations directory"
)
assert previews.get("vars", {}).get("DEFAULT_CHOIR_SLUG") == "tabor", (
    "Preview default choir slug must be tabor"
)
assert (root / preview_db["migrations_dir"]).is_dir(), "Preview migrations directory not found"

print("Preview config smoke test passed: Preview D1 is distinct from production and uses the expected migration directory and vars.")
