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
    assert '"/invitation": "invitation.html"' in WORKER
    assert '"/invitation/": "invitation.html"' in WORKER
    assert 'path === "/api/conductor/contacts"' in WORKER
    assert "phoneVerificationMatch" in WORKER

    # The dedicated UI shows a badge, but exposes WhatsApp actions only for verified numbers.
    INVITATION_JS = (ROOT / "public" / "invitation.js").read_text(encoding="utf-8")
    verified_branch = INVITATION_JS.index("if (phone && verified) {")
    whatsapp_branch = INVITATION_JS.index('whatsApp.href = "https://wa.me/"', verified_branch)
    end_verified_branch = INVITATION_JS.index('} else {', whatsapp_branch)
    assert verified_branch < whatsapp_branch < end_verified_branch
    assert "phoneVerifiedAt" in INVITATION_JS
    assert "Confirmă numărul" in INVITATION_JS
    assert "PIN-ul tău din 6 cifre" in INVITATION_JS

    MAIN_HTML = (ROOT / "public" / "index.html").read_text(encoding="utf-8")
    MAIN_JS = (ROOT / "public" / "app.js").read_text(encoding="utf-8")
    for old_section in ['aria-labelledby="invite-title"', 'aria-labelledby="members-title"', 'aria-labelledby="invitations-title"']:
        assert old_section not in MAIN_HTML, f"Admin section was not moved off main page: {old_section}"
    for old_selector in ['$("#invitation-form")', '$("#member-list")', '$("#invitation-list")']:
        assert old_selector not in MAIN_JS, f"Main page still references moved UI: {old_selector}"


    # New invitation codes do not collect a phone number from the conductor;
    # the member supplies the number during activation. Legacy codes may stay bound.
    create_invitation = function_body("createInvitation", "async function revokeInvitation")
    assert "normalizePhone(body.phone)" not in create_invitation
    assert "phoneHash" not in create_invitation
    activation_flow = function_body("activateAccount", "async function login")
    assert "if (candidate.intended_phone_hash)" in activation_flow
    INVITATION_HTML = (ROOT / "public" / "invitation.html").read_text(encoding="utf-8")
    assert 'id="invitation-phone"' not in INVITATION_HTML
    assert "își va completa propriul număr la activare" in INVITATION_HTML

    # Legal notices must be linked, and the current versions must be enforced server-side.
    assert 'const TERMS_VERSION = "2026-10-28-v2"' in WORKER
    assert 'const PRIVACY_VERSION = "2026-10-28-v3"' in WORKER
    assert 'body.acceptedLegal !== true' in WORKER
    assert 'action = \'legal.terms.accepted\'' in WORKER
    assert 'legalAcceptanceRequired: !(await hasCurrentLegalAcceptance' in WORKER
    assert 'path === "/api/legal/accept"' in WORKER
    require_session = function_body("requireSession", "function isConductor")
    assert "hasCurrentLegalAcceptance" in require_session
    bootstrap = function_body("bootstrapOwner", "async function activateAccount")
    assert "body.acceptedLegal !== true" in bootstrap
    assert "acceptedVia: \"owner_bootstrap\"" in bootstrap
    activation = function_body("activateAccount", "async function login")
    assert "body.acceptedLegal !== true" in activation
    assert "acceptedVia: \"account_activation\"" in activation
    login = function_body("login", "async function acceptLegalTerms")
    assert "legal_acceptance_required" in login
    assert "recordLegalAcceptance" in login

    LEGAL_HTML = (ROOT / "public" / "index.html").read_text(encoding="utf-8")
    LEGAL_JS = (ROOT / "public" / "app.js").read_text(encoding="utf-8")
    for control in ['id="setup-legal-accept"', 'id="activation-legal-accept"', 'id="legal-acceptance-form"']:
        assert control in LEGAL_HTML, f"Missing legal acceptance UI: {control}"
    assert 'acceptedLegal: $("#activation-legal-accept").checked' in LEGAL_JS
    assert 'acceptedLegal: $("#setup-legal-accept").checked' in LEGAL_JS
    assert 'acceptedLegal: $("#login-legal-accept").checked' in LEGAL_JS
    assert 'requestJSON("/api/legal/accept", "POST", { acceptedLegal: true })' in LEGAL_JS
    for path in ["termeni.html", "confidentialitate.html"]:
        assert (ROOT / "public" / path).is_file(), f"Missing legal document: {path}"
    assert '"/termeni": "termeni.html"' in WORKER
    assert '"/confidentialitate": "confidentialitate.html"' in WORKER
    privacy = (ROOT / "public" / "confidentialitate.html").read_text(encoding="utf-8")
    assert "numărul nu este public" in privacy.lower()
    assert "Cloudflare" in privacy
    assert "ANSPDCP" in privacy

    INVITATION_HTML = (ROOT / "public" / "invitation.html").read_text(encoding="utf-8")
    INVITATION_JS = (ROOT / "public" / "invitation.js").read_text(encoding="utf-8")
    assert 'id="legal-panel-form"' in INVITATION_HTML
    assert 'session.legalAcceptanceRequired' in INVITATION_JS
    assert 'requestJSON("/api/legal/accept", "POST", { acceptedLegal: true })' in INVITATION_JS
    # Async submit handlers must retain the form element before awaiting network work.
    assert "event.currentTarget.reset()" not in MAIN_JS
    assert "event.currentTarget.reset()" not in INVITATION_JS
    assert '$("#legal-acceptance-form").addEventListener("submit", async (event) => {\n  const form = event.currentTarget;' in MAIN_JS
    assert '$("#legal-panel-form").addEventListener("submit", async (event) => {\n  const form = event.currentTarget;' in INVITATION_JS



if __name__ == "__main__":
    main()
