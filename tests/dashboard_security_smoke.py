from pathlib import Path

root = Path(__file__).resolve().parents[1]
worker = (root / "src" / "index.ts").read_text()
main_html = (root / "public" / "index.html").read_text()
main_js = (root / "public" / "app.js").read_text()
dashboard_html = (root / "public" / "dashboard.html").read_text()
dashboard_js = (root / "public" / "dashboard.js").read_text()
migration = (root / "migrations" / "0006_immutable_audit_logs.sql").read_text()

# The UI labels both internal conductor roles simply as "Dirijor".
assert 'const roleNames = { owner: "Dirijor", conductor: "Dirijor", member: "Membru" };' in main_js
assert 'id="admin-dashboard-link"' in main_html
assert 'adminDashboardLink.classList.toggle("hidden", user.role !== "owner")' in main_js

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
assert '"conductor.song.delete_reauthentication_failed"' in delete
assert '"conductor.song.deleted"' in delete
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
