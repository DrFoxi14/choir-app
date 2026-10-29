from pathlib import Path

root = Path(__file__).resolve().parents[1]
worker = (root / "src" / "index.ts").read_text()
home = (root / "public" / "index.html").read_text()
app = (root / "public" / "app.js").read_text()
migration = (root / "migrations" / "0005_backblaze_media.sql").read_text()

# The private bucket can only be accessed through server-issued short-lived SigV4 URLs.
for binding in ["B2_ENDPOINT", "B2_REGION", "B2_BUCKET", "B2_KEY_ID", "B2_APP_KEY"]:
    assert binding in worker, f"Missing Backblaze binding {binding}"
assert "presignB2Object" in worker
assert "X-Amz-Signature" in worker
assert 'presignB2Object(config, "PUT"' in worker
assert 'presignB2Object(config, "HEAD"' in worker
assert 'presignB2Object(config, "GET"' in worker
assert 'fetch(headUrl, { method: "HEAD" })' in worker
assert 'status = \'pending\'' in worker

# Public catalog responses expose only asset IDs/format/voice, never B2 object keys or credentials.
catalog_start = worker.index("async function listSongs(")
catalog_end = worker.index("async function listConductorSongs(", catalog_start)
catalog = worker[catalog_start:catalog_end]
assert "object_key" not in catalog
assert "song_assets" in catalog and "status = 'published'" in catalog
assert "asset.status" not in catalog

# All upload and download routes require an authenticated session plus conductor/member policy checks.
for route in [
    '"/api/conductor/media/status"',
    '"/api/conductor/songs"',
    '"/api/conductor/assets/complete"',
]:
    assert route in worker, f"Missing route {route}"
assert 'songUploadMatch = path.match' in worker
assert 'assetDownloadMatch = path.match' in worker
assert 'if (current.role === "member" &&' in worker
assert 'upload.createdByUserId !== current.userId' in worker
assert 'storedSize !== upload.sizeBytes' in worker
assert 'storedType !== upload.contentType.toLowerCase()' in worker

# Conductor UI supports creating a draft, uploading per voice/type, and then publishing it.
for element in [
    'id="media-song-create-form"', 'id="media-upload-form"',
    'id="media-song-select"', 'id="media-voice-select"',
    'id="media-format-select"', 'id="media-file-input"',
    'id="media-song-list"', 'id="media-storage-status"'
]:
    assert element in home, f"Missing media UI element {element}"
assert 'method: "PUT"' in app
assert '"/api/conductor/assets/complete"' in app
assert '"/api/conductor/songs/" + encodeURIComponent(song.id) + "/publish"' in app

# The migration records upload reservations; object keys never need to be put in public catalog payloads.
assert "CREATE TABLE IF NOT EXISTS media_uploads" in migration
assert "ALTER TABLE song_assets ADD COLUMN file_name TEXT" in migration
assert "UNIQUE" in migration and "expires_at" in migration
print("Backblaze media smoke test passed: signed URLs, access checks, catalog privacy, and upload UI.")
