from pathlib import Path

root = Path(__file__).resolve().parents[1]
worker = (root / "src" / "index.ts").read_text()

start = worker.index("async function downloadSongAsset(")
end = worker.index("async function listMemberContacts(", start)
download = worker[start:end]

# The endpoint must authenticate first and must hide non-existent, archived,
# unpublished, and wrong-voice assets from members.
assert download.index("await requireSession(request, env)") < download.index("SELECT a.id")
assert 'asset.assetStatus === "archived"' in download
assert 'asset.songStatus === "archived"' in download
assert 'asset.assetStatus !== "published"' in download
assert 'asset.songStatus !== "published"' in download
assert 'asset.voicePart !== current.voicePart' in download

# The browser receives a capability that lasts five minutes, not one hour.
assert 'presignB2Object(config, "GET", asset.objectKey, 300)' in download
assert 'presignB2Object(config, "GET", asset.objectKey, 3600)' not in download

# Filename output must support UTF-8 names and still have a conservative ASCII fallback.
assert "Content-Disposition" in download
assert "filename*=UTF-8''" in download
assert "safeAsciiName" in download
assert "safeUploadFileName(asset.fileName)" in download

# Audit contains only non-secret, low-sensitivity metadata and never the signed URL or storage path.
audit_start = download.index('await recordAudit')
audit_end = download.index('return new Response', audit_start)
audit = download[audit_start:audit_end]
assert '"media.asset.download_link_issued"' in audit
assert "format: asset.format" in audit
assert "voicePart: asset.voicePart" in audit
assert "signedUrl" not in audit
assert "objectKey" not in audit

# Redirect responses must not be cached, and Referer must not leak the signed URL.
assert '"Cache-Control": "no-store, max-age=0"' in download
assert '"Referrer-Policy": "no-referrer"' in download

print("Media download security smoke test passed.")
