# Legal / privacy launch checklist

This checklist is internal. The public privacy notice is a practical draft, not a substitute for confirming the actual controller and legal basis.

Before inviting members to create accounts:

- [ ] Confirm who actually determines the purposes and means of the Choir App data processing. Do not assume that “Corul Tabor” is a legal entity. If a church/association operates the choir, confirm the correct entity and role.
- [ ] Replace the visible “De completat înainte de lansarea oficială” section in `public/confidentialitate.html` with the controller's full legal name, postal address, and a direct email or other effective contact for data-rights requests.
- [ ] Confirm the actual Article 6 GDPR legal bases for account/phone processing. If relying on legitimate interests under Article 6(1)(f), write and retain a short balancing assessment before launch.
- [ ] Agree and implement practical retention/deletion periods for inactive accounts, sessions, invitations, rate-limit entries, and audit logs. The notice states criteria; the operator must make those criteria operational.
- [ ] Decide how the controller will process access, correction, deletion, restriction, portability, and objection requests. The app does not yet provide self-service account deletion, so a real contact and a manual process are necessary.
- [ ] Verify the controller's arrangements with Cloudflare for hosting/D1, including the applicable data-processing terms and transfer safeguards described in the vendor's current documents.
- [ ] When a conductor enters a phone number to issue an invitation, give the invitee the privacy notice at the first communication/activation flow, and do not rely solely on the number's presence in a WhatsApp group as authorization for unrelated use.
- [ ] If minors will use the app, verify the appropriate notice, permissions, and safeguards for the concrete context before onboarding them.
- [ ] Check that legal links work on desktop and mobile, new activation is blocked without the checkbox, old sessions are gated until current documents are accepted, and acceptance is recorded with both current version identifiers.
- [ ] When the terms or notice materially change, update the version constants near the top of `src/index.ts` and rerun CI.

Acceptance is recorded in the existing `audit_logs` table as `legal.terms.accepted`, with terms/privacy version values and the acceptance path. The checkbox is a record of accepting the terms and acknowledging the privacy notice; it is not a blanket consent for all personal-data processing.
