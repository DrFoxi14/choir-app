from pathlib import Path
import tomllib

root = Path(__file__).resolve().parents[1]
worker = (root / "src" / "index.ts").read_text()
main_html = (root / "public" / "index.html").read_text()
main_js = (root / "public" / "app.js").read_text()
dashboard_html = (root / "public" / "dashboard.html").read_text()
dashboard_js = (root / "public" / "dashboard.js").read_text()
migration = (root / "migrations" / "0006_immutable_audit_logs.sql").read_text()

assets_config = tomllib.loads((root / "wrangler.toml").read_text()).get("assets", {})
worker_first_routes = assets_config.get("run_worker_first", [])

# The UI labels both internal conductor roles simply as "Dirijor".
assert 'const roleNames = { owner: "Dirijor", conductor: "Dirijor", member: "Membru" };' in main_js
assert 'id="admin-dashboard-link"' in main_html
assert 'id="toggle-media-library"' in main_html
assert 'aria-controls="conductor-media-library"' in main_html
assert 'id="conductor-media-library" class="panel dashboard-section conductor-media-library hidden"' in main_html
assert "media-storage-diagnose" not in main_html, "B2 diagnostics should not clutter the main conductor page"
assert 'id="media-storage-diagnose"' in dashboard_html
assert 'id="media-diagnose-message"' in dashboard_html
assert 'fetch("/api/conductor/media/diagnose"' in dashboard_js
assert 'mediaLibraryToggle.textContent = isHidden ? "Adaugă cântare" : "Închide biblioteca"' in main_js
assert 'deleteToggle.className = "danger-button danger-button-compact"' in main_js
assert 'deleteToggle.textContent = "Șterge"' in main_js
assert 'runBackblazeDiagnostic' not in main_js, "B2 diagnostics should be moved out of main page JavaScript"
assert 'adminDashboardLink.classList.toggle("hidden", user.role !== "owner")' in main_js

# Worker-first routing is required so static assets cannot intercept the protected dashboard path.
assert "/api/*" in worker_first_routes
assert "/dashboard*" in worker_first_routes, "Dashboard requests must reach the Worker before static assets"
assert 'if (url.pathname === "/dashboard" || url.pathname === "/dashboard/" || url.pathname === "/dashboard.html") {' in worker

# Both the HTML route and data endpoint enforce owner-only access server-side.
assert '"/dashboard": "dashboard.html"' in worker
assert 'if (!current || current.role !== "owner" ||' in worker
assert 'if (current.role !== "owner" || !(await hasCurrentLegalAcceptance' in worker
assert '"/api/dashboard/logs"' in worker
assert "WHERE a.choir_id = ?" in worker
assert 'ORDER BY a.created_at DESC, a.rowid DESC LIMIT ?' in worker

# Song removal requires the signed-in conductor's PIN, rate-limits attempts,
# audits failed reauthentication and archives assets rather than exposing storage.
start = worker.index("async function deleteSong(")
end = worker.index("async function prepareMediaUpload(", start)
delete = worker[start:end]
assert "validPin(body.pin)" in delete
assert "derivePinHash(" in delete and "constantTimeEqual(" in delete
assert "song-delete-ip" in delete and "song-delete-user" in delete
assert "conductor.song.delete_reauthentication_failed" in delete
assert "conductor.song.deleted" in delete
assert "SET status = 'archived'" in delete
assert "UPDATE song_assets SET status = 'archived'" in delete
assert "objectKey" not in delete and "presignB2Object" not in delete

# Audit payloads are filtered for secrets; there are no audit mutation endpoints or UI actions.
assert "sanitizeAuditMetadata" in worker
assert "phone|pin|code|token|secret|password|email|hash|ip|object.?key|signed.?url" in worker
assert "UPDATE audit_logs" not in worker
assert "DELETE FROM audit_logs" not in worker
assert "audit_logs_block_update" in migration
assert "audit_logs_block_delete" in migration
assert "RAISE(ABORT, 'audit_logs are immutable')" in migration
assert "numai pentru citire" in dashboard_html.lower()
assert "audit-delete" not in dashboard_html + dashboard_js
assert 'method: "DELETE"' not in dashboard_js

print("Song deletion, owner-only dashboard, and immutable audit smoke test passed.")
