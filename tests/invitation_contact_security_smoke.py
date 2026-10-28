from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
WORKER = (ROOT / "src" / "index.ts").read_text(encoding="utf-8")


def function_body(name: str, next_marker: str) -> str:
    start = WORKER.index(f"async function {name}(")
    end = WORKER.index(next_marker, start)
    return WORKER[start:end]


def main() -> None:
    contacts = function_body("listMemberContacts", "async function listMembers")
    members = function_body("listMembers", "async function listInvitations")

    # Phone numbers must be served only by the PIN-confirmed endpoint.
    assert "requireSession(request, env)" in contacts
    assert "isConductor(current)" in contacts
    assert "validPin(body.pin)" in contacts
    assert "conductor-contacts-ip" in contacts
    assert "conductor-contacts-user" in contacts
    assert "current.choirId" in contacts
    assert "u.email_normalized AS phoneNumber" in contacts
    assert "recordAudit(" in contacts

    # The general members endpoint must not expose phone numbers.
    assert "phoneNumber" not in members
    assert "email_normalized" not in members

    verification = function_body("updateMemberPhoneVerification", "async function createInvitation")
    assert "requireSession(request, env)" in verification
    assert "isConductor(current)" in verification
    assert "manageableMember(env, current, targetId)" in verification
    assert "validPin(body.pin)" in verification
    assert "phone_verified_at" in verification
    assert "phone_verified_by_user_id" in verification
    assert "phone-verification-user" in verification
    assert "recordAudit(" in verification

    # The route serves a dedicated asset, while data remains API-protected.
    assert 'url.pathname === "/invitation"' in WORKER
    assert 'path === "/api/conductor/contacts"' in WORKER
    assert "phoneVerificationMatch" in WORKER


if __name__ == "__main__":
    main()
