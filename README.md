# Choir App — Corul Tabor

Source repository for Choir App — temporarily public during initial development. Return it to private before launch. Never commit secrets, real member data, or choir audio/video/PDF files.

## Product goals

- Mobile-first song catalog for choir members, with an account-linked voice part (Soprano, Alto, Tenor, Bass).
- Separate member and conductor roles.
- One main owner account plus individually invited conductor accounts. The owner can invite other conductors; conductors can invite members.
- A dedicated `/invitation` page for conductor invitations, member contacts, invitation revocation, PIN reset codes, and account-code renewal.
- A conductor-confirmed phone verification badge. WhatsApp actions are hidden until the number is manually verified; changing the phone number clears verification.
- D1 records scoped to the current choir; the schema supports multiple choirs.
- Account-level accent palettes stored in D1, with eight curated colors.
- Conductor-only attendance recording and date-range reports exported locally as real `.xlsx` or `.md` downloads.

## Current implementation status

The current feature branch adds account activation, sign-in, signed-out state, session validation, role-gated conductor endpoints, single-use expiring invitations, account-code renewal, PIN reset, HMAC-keyed rate-limit records, audit events, and a conductor dashboard.

**This branch is not yet production-ready.** Before enabling account access, apply migrations **0002**, **0003**, and **0004_preferences_attendance.sql**, configure the Worker secrets described below, and run the CI checks. The new **0004** migration creates only relational D1 tables; it does not require R2. Then complete a real browser test of bootstrap, member activation, conductor invitations, login, logout, rate limits, role boundaries, phone verification, and PIN reset.

The audio, PDF, and video delivery pipeline is not implemented yet. The current UI deliberately shows these formats as unavailable. The API never returns storage object keys or media URLs. **R2 is not needed for account colors, attendance records, or the Excel/Markdown exports**: preferences and attendance stay in D1, while `.xlsx` and `.md` files are generated in the conductor’s browser and downloaded directly. Keep R2 unconfigured until a private-media plan is ready.

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

Migration 0001 uses IF NOT EXISTS/INSERT OR IGNORE for its schema setup, so it is safe to apply if its SQL was previously run manually in the D1 dashboard but Wrangler has not yet recorded the migration. Apply migrations 0002 and 0003 as well; migration 0003 adds conductor-confirmed phone verification fields. Prefer the migration command over manually pasting later migrations into the dashboard, so Wrangler can record the migrations and avoid re-applying them later.

### Create the first account

After the code is merged and the new Worker build is live, open **https://cor.tabororadea.workers.dev**. The one-time bootstrap form should appear when D1, AUTH_SECRET, and BOOTSTRAP_SETUP_KEY are configured and no owner exists. Create the main owner account and record the account code shown once.

After the initial owner account has been created successfully, **remove BOOTSTRAP_SETUP_KEY from Worker secrets**. Leave AUTH_SECRET configured. Removing the bootstrap secret closes the bootstrap form; the existing owner can then create invitation codes from the conductor dashboard.

To support approximately seven conductors, use the owner account for one conductor and issue separate **Dirijor** invitations to the other six. Each person activates their own account and chooses a private six-digit PIN. There is no hardcoded seven-person limit.

Member invitations specify the member's voice and expire after seven days. PIN reset codes expire after 30 minutes and are single-use. The application stores only hashes for account codes, activation codes, reset codes, and opaque session tokens. PINs are stored as salted PBKDF2 hashes. Sessions use **HttpOnly**, **Secure**, **SameSite=Lax** cookies and expire after 14 days. Unauthenticated catalog requests are denied.

If a member loses the account code, a dirijor can generate a replacement; the old code stops working. If the member forgets the PIN, a dirijor can issue a one-time reset code. Share both codes only with the intended member.

## Deployment

The current Cloudflare Worker is connected to **DrFoxi14/choir-app** with **main** as its production branch and **npx wrangler deploy** as the deploy command. Pushes merged to main are therefore handled by Cloudflare's native Git integration.

The GitHub Actions **Deploy Choir App** workflow is manual and guarded by the repository Actions variable **ENABLE_CLOUDFLARE_DEPLOY=true**. It lists and applies pending D1 migrations before deploying the Worker. The Cloudflare token must be scoped to the dedicated Tabor account and include D1 Edit plus the Workers permission needed to create/deploy the Worker. If Cloudflare native Git integration is configured, disable one deployment path so two systems do not deploy to production independently.

The current Worker name is **cor**, with the expected URL **https://cor.tabororadea.workers.dev**. The D1 binding is configured in wrangler.toml. Do not create R2 buckets or enable paid storage until the private media delivery design is ready.

## Security and operational notes

- The code in this branch needs a real browser/end-to-end security test before launch. CI checks the TypeScript, browser-JavaScript syntax, and database migration shape; it does not prove that the complete browser-to-Cloudflare flow works.
- Use a supported browser with HTTPS. All state-changing API endpoints require a same-origin Origin header.
- Rate-limit buckets use keyed HMAC identifiers rather than storing raw client IP addresses or account codes.
- Conductors can invite members. Only the owner can issue conductor invitations. Non-owner conductors cannot reset or replace another conductor's access codes.
- `/invitation` is a dedicated conductor contacts/invitations page. Contact numbers are returned only from a conductor-only POST endpoint after re-entering the six-digit PIN, rate-limited and audited; regular catalog/list endpoints never return member phone numbers.
- The `phone_verified_at` flag is stored per choir membership. An authorized conductor can set it only after re-entering their PIN; this is a manual confirmation, not verification by WhatsApp/SMS. WhatsApp links appear only when verified. Changing a member phone clears verification across the account's choir memberships.
- Catalog queries are scoped to the resolved choir. Asset object keys and URLs are not returned by the API. Private media signing/streaming, file uploads, song publishing tools, additional monitoring, and end-to-end tests remain future work.
- Secrets, private access codes, real member information, and private media must never be committed to the repository.
