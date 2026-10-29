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

# Private download links use a short capability lifetime, a safe download filename,
# and an audit event that deliberately excludes the signed URL/object key.
download_start = worker.index("async function downloadSongAsset(")
download_end = worker.index("async function listMemberContacts(", download_start)
download = worker[download_start:download_end]
assert 'presignB2Object(config, "GET", asset.objectKey, 300)' in download
assert 'Content-Disposition' in download and "filename*=UTF-8''" in download
assert 'media.asset.download_link_issued' in download
audit_start = download.index('await recordAudit')
audit_end = download.index('return new Response', audit_start)
audit = download[audit_start:audit_end]
assert '"media.asset.download_link_issued"' in audit
assert "format: asset.format" in audit
assert "voicePart: asset.voicePart" in audit
assert "signedUrl" not in audit, "Signed URLs must not be audited"
assert "objectKey" not in audit, "Private object keys must not be audited"
diagnostic_start = worker.index("async function diagnoseMediaStorage(")
diagnostic_end = worker.index("async function createSong(", diagnostic_start)
diagnostic = worker[diagnostic_start:diagnostic_end]
assert "const corsProbeUrl = config.endpoint.origin +" in diagnostic
assert "fetch(corsProbeUrl, {" in diagnostic
assert 'fetch(putUrl, {\n      method: "OPTIONS"' not in diagnostic, "CORS probe must not use a URL signed for PUT"

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
    '"/api/conductor/media/diagnose"',
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
    'id="media-song-list"', 'id="media-storage-status"',
    'id="media-storage-diagnose"', 'id="media-diagnose-message"'
]:
    assert element in home, f"Missing media UI element {element}"
assert 'method: "PUT"' in app
assert '"/api/conductor/assets/complete"' in app
assert '"/api/conductor/songs/" + encodeURIComponent(song.id) + "/publish"' in app

# The migration records upload reservations; object keys never need to be put in public catalog payloads.
assert "CREATE TABLE IF NOT EXISTS media_uploads" in migration
assert "ALTER TABLE song_assets ADD COLUMN file_name TEXT" in migration
assert "UNIQUE" in migration and "expires_at" in migration

# Diagnostics compare a signed missing-object response with the real S3 CORS preflight.
assert 'async function diagnoseMediaStorage' in worker
assert '"Access-Control-Request-Method": "PUT"' in worker
assert '"Access-Control-Request-Headers", "content-type"' in worker
assert 'async function probeCors(includeContentType: boolean)' in worker
assert 'corsMethodOnly' in worker and 'corsWithContentType' in worker
assert 'Access-Control-Allow-Origin' in worker
assert 'Access-Control-Allow-Methods' in worker
assert 'Access-Control-Allow-Headers' in worker
assert '"/api/conductor/media/diagnose"' in app
assert 'Testează conexiunea B2' in home
assert 'Browserul nu a putut citi răspunsul Backblaze' in app

print("Backblaze media smoke test passed: signed URLs, access checks, catalog privacy, and upload UI.")
