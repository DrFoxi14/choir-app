# Choir App — Corul Tabor

Source repository for Choir App — temporarily public during initial development. Return it to private before launch. Never commit secrets, real member data, or choir audio/video/PDF files.

## Product goals

- Mobile-first song catalog for choir members, with an account-linked voice part (Soprano, Alto, Tenor, Bass).
- Separate member and conductor roles.
- One main owner account plus individually invited conductor accounts. The owner can invite other conductors; conductors can invite members.
- Conductor tools for active-member lists, invitation revocation, PIN reset codes, and account-code renewal.
- D1 records scoped to the current choir; the schema supports multiple choirs.

## Current implementation status

The current feature branch adds account activation, sign-in, signed-out state, session validation, role-gated conductor endpoints, single-use expiring invitations, account-code renewal, PIN reset, HMAC-keyed rate-limit records, audit events, and a conductor dashboard.

**This branch is not yet production-ready.** Before merging/deploying it, apply migration **migrations/0002_member_auth_and_conductors.sql**, configure the Worker secrets described below, and run the CI checks. Then complete a real browser test of bootstrap, member activation, conductor invitations, login, logout, rate limits, role boundaries, and PIN reset.

The audio, PDF, and video delivery pipeline is not implemented yet. The current UI deliberately shows these formats as unavailable. The API never returns storage object keys or media URLs. R2 is not required for the authentication work and should remain unconfigured until a private-media plan is ready.

## Stack

- Cloudflare Workers (TypeScript)
- Cloudflare Workers Static Assets
- Cloudflare D1 for relational metadata, accounts, sessions, invitations, and audit events
- GitHub Actions for CI
- Cloudflare's native GitHub integration for production deploys from **main**

## Local development and checks

Requirements: Node.js 22 or later, npm, and Python 3.

Install dependencies with **npm install**, then start the development server with **npm run dev**.

Run the checks:

- **npm run typecheck**
- **node --check public/app.js**
- **python3 tests/schema_smoke.py**

The schema smoke test applies the initial schema and the auth migration to an in-memory SQLite database, then checks the new columns, tables, indexes, seed row, and foreign keys.

## Required Cloudflare setup before enabling account access

Do this in the dedicated Cloudflare account for **cor**, under **Workers & Pages → cor → Settings → Variables and Secrets → Production**. Add these as **secrets**, not plain variables:

1. **AUTH_SECRET** — a randomly generated secret with at least 32 characters. It is used to HMAC rate-limit identifiers; do not put it in source control or send it in chat.
2. **BOOTSTRAP_SETUP_KEY** — a separate randomly generated secret with at least 32 characters. It permits the one-time creation of the initial owner account.

The backend fails closed if **AUTH_SECRET** is missing or too short. The bootstrap endpoint is available only when **BOOTSTRAP_SETUP_KEY** exists and no active owner is registered for the Tabor choir.

### Apply the D1 migration

The existing database is named **choir-app-db**. Apply both migrations using Wrangler migration tracking after authenticating Wrangler to the correct Cloudflare account:

**npx wrangler d1 migrations apply choir-app-db --remote**

Migration 0001 uses IF NOT EXISTS/INSERT OR IGNORE for its schema setup, so it is safe to apply if its SQL was previously run manually in the D1 dashboard but Wrangler has not yet recorded the migration. Prefer the migration command over manually pasting migration 0002 into the dashboard, so Wrangler can record the migration and avoid re-applying it later.

### Create the first account

After the code is merged and the new Worker build is live, open **https://cor.tabororadea.workers.dev**. The one-time bootstrap form should appear when D1, AUTH_SECRET, and BOOTSTRAP_SETUP_KEY are configured and no owner exists. Create the main owner account and record the account code shown once.

After the initial owner account has been created successfully, **remove BOOTSTRAP_SETUP_KEY from Worker secrets**. Leave AUTH_SECRET configured. Removing the bootstrap secret closes the bootstrap form; the existing owner can then create invitation codes from the conductor dashboard.

To support approximately seven conductors, use the owner account for one conductor and issue separate **Dirijor** invitations to the other six. Each person activates their own account and chooses a private six-digit PIN. There is no hardcoded seven-person limit.

Member invitations specify the member's voice and expire after seven days. PIN reset codes expire after 30 minutes and are single-use. The application stores only hashes for account codes, activation codes, reset codes, and opaque session tokens. PINs are stored as salted PBKDF2 hashes. Sessions use **HttpOnly**, **Secure**, **SameSite=Lax** cookies and expire after 14 days. Unauthenticated catalog requests are denied.

If a member loses the account code, a dirijor can generate a replacement; the old code stops working. If the member forgets the PIN, a dirijor can issue a one-time reset code. Share both codes only with the intended member.

## Deployment

The current Cloudflare Worker is connected to **DrFoxi14/choir-app** with **main** as its production branch and **npx wrangler deploy** as the deploy command. Pushes merged to main are therefore handled by Cloudflare's native Git integration.

Keep the GitHub Actions **Deploy Choir App** workflow disabled unless the deployment method is deliberately changed. Do not run two production deploy systems at once. The **ENABLE_CLOUDFLARE_DEPLOY** variable controls the separate manual GitHub Actions workflow, not Cloudflare's native Git integration.

The current Worker name is **cor**, with the expected URL **https://cor.tabororadea.workers.dev**. The D1 binding is configured in wrangler.toml. Do not create R2 buckets or enable paid storage until the private media delivery design is ready.

## Security and operational notes

- The code in this branch needs a real browser/end-to-end security test before launch. CI checks the TypeScript, browser-JavaScript syntax, and database migration shape; it does not prove that the complete browser-to-Cloudflare flow works.
- Use a supported browser with HTTPS. All state-changing API endpoints require a same-origin Origin header.
- Rate-limit buckets use keyed HMAC identifiers rather than storing raw client IP addresses or account codes.
- Conductors can invite members. Only the owner can issue conductor invitations. Non-owner conductors cannot reset or replace another conductor's access codes.
- `/invitation` is a dedicated conductor contacts/invitations page. Contact numbers are returned only from a conductor-only POST endpoint after re-entering the six-digit PIN, rate-limited and audited; regular catalog/list endpoints never return member phone numbers.
- Catalog queries are scoped to the resolved choir. Asset object keys and URLs are not returned by the API. Private media signing/streaming, file uploads, song publishing tools, additional monitoring, and end-to-end tests remain future work.
- Secrets, private access codes, real member information, and private media must never be committed to the repository.
