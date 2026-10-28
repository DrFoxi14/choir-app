# Legal / privacy launch checklist

This checklist is internal. The public documents have been updated to match the intended product flow, but this checklist is not a legal opinion and must be completed before the official launch.

## Identity and responsibility
- [x] Publish the operator/contact information supplied for the choir: Biserica Penticostală Tabor, nr. 5, CUI 8189917, Str. Meiului nr. 4, Oradea, Bihor; operational contact email: dumbohaiosu@gmail.com. The church's public contact page lists the same CUI and address.
- [ ] Have church leadership confirm that this exact legal entity is the controller for Choir App and authorize the contact mailbox for data-rights requests.
- [ ] Confirm the admin's role. If Paul operates infrastructure or processes data separately from the church's authority, document the correct arrangement under GDPR Article 28 or another applicable legal instrument.

## Legal basis, religion-related information and minors
- [ ] Document the Article 6 GDPR legal basis for account administration, coordination, and security. If relying on legitimate interests under Article 6(1)(f), create and retain a short balancing assessment that gives specific attention to children.
- [ ] Because participation in a church choir may reveal religious beliefs, obtain a legal check of the Article 9 condition relied on. Confirm the organization's legal/non-profit status and that the processing, safeguards, and any access by Cloudflare or other service providers meet the applicable condition. Do not treat the ordinary terms checkbox as explicit consent to special-category processing.
- [ ] Before onboarding minors, define and actually follow a practical process for parent/guardian involvement and any legally required approval. The current app does not verify age or capture/verify guardian authorization; the checkbox alone is not proof of it.
- [ ] Check whether child-friendly/plain-language information or any extra safeguards are appropriate for the choir's actual age range.

## Data minimisation, security and operations
- [x] New invitations do not ask the conductor to enter a member's phone number. The member enters their own number during account activation. Previously created phone-bound invitations remain restricted by their existing hash until expiry/revocation.
- [ ] Agree and apply documented retention periods for inactive accounts, audit/security logs, rate-limit entries, and data after a member leaves. Current code sets invitation expiry to 7 days, reset codes to 30 minutes, and sessions to 14 days, but does not itself provide a complete retention schedule.
- [ ] Verify the operational process for receiving and answering access, correction, deletion, restriction, portability, and objection requests at the published email. Self-service account deletion is not currently available.
- [ ] Verify Cloudflare's applicable data-processing terms, the app's D1/gateway configuration, transfer safeguards, and the actual locations/retention of logs under the selected service.
- [ ] Make sure conductors are told that contact details may only be used for internal choir coordination and that opening a WhatsApp link sends the user to an external service.
- [ ] Confirm access controls, invitation revocation, legal links, activation/login acceptance, and audit-log version recording on desktop and mobile.
- [ ] Run the repository smoke tests and TypeScript typecheck after the changes, then inspect CI. Do not label the production deployment verified until the deployed version has been tested.

## Document versions
The public documents use versions `2026-10-28-v2`. If either changes materially, update `TERMS_VERSION` and `PRIVACY_VERSION` near the top of `src/index.ts`, then rerun all tests.

The checkbox is a record of accepting the terms and acknowledging that the privacy notice has been read. It is not a blanket consent for all processing, nor does it replace a separate legal basis.
