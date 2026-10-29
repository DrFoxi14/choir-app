# Choir App — Corul Tabor

Source repository for Choir App — temporarily public during initial development. Return it to private before launch. Never commit secrets, real member data, or choir audio/video/PDF files.

## Product goals

- Mobile-first song catalog for choir members, with an account-linked voice part (Soprano, Alto, Tenor, Bass).
- Separate member and conductor roles.
- One main owner account plus individually invited conductor accounts. The owner can invite other conductors; conductors can invite members.
- A dedicated `/invitation` page for conductor invitations, member contacts, invitation revocation, PIN reset codes, and account-code renewal.
- A dedicated `/account` page for saved personal color palettes and account settings; changing a phone number is hidden behind the **Schimbă numărul** button until requested.
- A dedicated `/prezenta` page for conductor-only attendance recording and date-range Excel/Markdown exports.
- A conductor-confirmed phone verification badge. WhatsApp actions are hidden until the number is manually verified; changing the phone number clears verification.
- D1 records scoped to the current choir; the schema supports multiple choirs.
- Account-level accent palettes stored in D1, with eight curated colors.
- Conductor-only attendance recording and date-range reports exported locally as real `.xlsx` or `.md` downloads.

## Current implementation status

The current feature branch adds account activation, sign-in, signed-out state, session validation, role-gated conductor endpoints, single-use expiring invitations, account-code renewal, PIN reset, HMAC-keyed rate-limit records, audit events, and a conductor dashboard.

**This branch is not yet production-ready.** Before enabling account access, apply migrations **0002**, **0003**, and **0004_preferences_attendance.sql**, configure the Worker secrets described below, and run the CI checks. The new **0004** migration creates only relational D1 tables; it does not require R2. Then complete a real browser test of bootstrap, member activation, conductor invitations, login, logout, rate limits, role boundaries, phone verification, and PIN reset.

This branch adds private Backblaze B2 storage for choir PDFs, audio, and videos using the S3-Compatible API and short-lived AWS Signature Version 4 URLs. Uploads go directly from the conductor's browser to B2; the Worker creates upload reservations, verifies the uploaded object's size/content type, and stores only metadata plus the private object key in D1. The object key and B2 credentials are never returned by the catalog API. The integration remains disabled until the B2 endpoint, bucket, and application-key credentials are configured as Cloudflare Worker variables/secrets.

## Stack

- Cloudflare Workers (TypeScript)
- Cloudflare Workers Static Assets
- Cloudflare D1 for relational metadata, accounts, sessions, invitations, and audit events
- Backblaze B2 private bucket via S3-Compatible API for PDFs, audio, and video
- GitHub Actions for CI
- Cloudflare's native GitHub integration for production deploys from **main**

## Backblaze B2 media storage

### 1. Create a private bucket and restricted application key

In Backblaze B2, create a **private** bucket for Choir App. Note the region, bucket name, and S3 endpoint; the endpoint format is `https://s3.<region>.backblazeb2.com`. Create a new application key, not the master application key. Restrict it to this bucket and, where supported, the `choir_tabor/` file-name prefix. Grant only `readFiles` and `writeFiles`; the app does not need deletion permissions. See Backblaze's [S3-Compatible API guide](https://www.backblaze.com/docs/cloud-storage-s3-compatible-api) and [application-key capabilities](https://www.backblaze.com/docs/cloud-storage-s3-compatible-app-keys).

### 2. Configure the Cloudflare Worker

In Cloudflare Dashboard → Workers & Pages → `cor` → Settings → Variables and Secrets → Production, add these **variables**:

- `B2_ENDPOINT`: for example, `https://s3.us-west-004.backblazeb2.com` (replace with the exact endpoint for the bucket's region)
- `B2_REGION`: the region component, for example `us-west-004`
- `B2_BUCKET`: the exact private bucket name

Add these as **secrets**, not plain variables:

- `B2_KEY_ID`: the restricted application key ID
- `B2_APP_KEY`: the matching application key

Do not paste either key into GitHub source files or into chat. The app checks that endpoint and region match and fails closed when the configuration is incomplete.

### 3. Allow direct browser uploads with S3 CORS

In the bucket's CORS settings, choose the **S3-Compatible API** and allow only this origin and upload method:

- Origin: `https://cor.tabororadea.workers.dev`
- Method: `PUT`
- Allowed request header: `content-type`

If the app later uses another public hostname, add that exact origin separately. Do not allow every origin. CORS permits the browser upload request; it does not make the bucket public or replace signed-request authorization. Backblaze's [S3 CORS guide](https://www.backblaze.com/docs/cloud-storage-enable-cors-with-the-s3-compatible-api) documents the bucket rules.

If a browser upload fails, use **Testează conexiunea B2** in the conductor media library. The diagnostic performs a signed read request to a random, non-existing object and a simulated S3 CORS preflight for `PUT` with `content-type`. It reports status codes and CORS response headers but never returns signed URLs or storage credentials. A valid signature check should return the expected missing-object response; CORS must allow the Worker origin, `PUT`, and `content-type`.

### 4. Use the media library

Sign in as a conductor or owner. In **Biblioteca de fișiere**, create a song as a draft, choose the song, voice and file type, upload one file, then publish the song. Only published assets for a member's assigned voice are returned in their catalog. The catalog never exposes B2 object keys; downloads redirect to short-lived signed URLs.

Supported limits in this initial integration: PDF up to 50 MB, audio up to 500 MB, video up to 2 GB. The upload URL expires after 15 minutes. Replacing a file archives the previous metadata record; it does not delete the previous B2 object.

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

- The code still needs a real browser/end-to-end security test before launch. CI checks TypeScript, browser-JavaScript syntax, database migration shape, and static security invariants for private media downloads; these checks do not prove that the complete browser-to-Cloudflare flow works.
- Use a supported browser with HTTPS. All state-changing API endpoints require a same-origin Origin header.
- Rate-limit buckets use keyed HMAC identifiers rather than storing raw client IP addresses or account codes.
- Conductors can invite members. Only the owner can issue conductor invitations. Non-owner conductors cannot reset or replace another conductor's access codes.
- `/invitation` is a dedicated conductor contacts/invitations page. Contact numbers are returned only from a conductor-only POST endpoint after re-entering the six-digit PIN, rate-limited and audited; regular catalog/list endpoints never return member phone numbers.
- The `phone_verified_at` flag is stored per choir membership. An authorized conductor can set it only after re-entering their PIN; this is a manual confirmation, not verification by WhatsApp/SMS. WhatsApp links appear only when verified. Changing a member phone clears verification across the account's choir memberships.
- Catalog queries are scoped to the resolved choir. Asset object keys are not returned by catalog APIs; download redirects issue five-minute signed URLs and audit link issuance without storing signed URLs or object keys in audit metadata. Direct private B2 uploads, upload verification, and song publishing are implemented.
- Song deletion requires the acting conductor's six-digit PIN and archives the song plus its catalog assets. Because the restricted B2 key intentionally has no delete permission, the blobs remain private in B2 and are not physically removed by this action.
- The `/dashboard` administration page and `/api/dashboard/logs` endpoint are restricted to the owner account (shown in the UI simply as **Dirijor**). It is read-only; migration `0006_immutable_audit_logs.sql` uses D1 triggers to reject audit-log UPDATE/DELETE. Dashboard metadata is filtered to avoid exposing PINs, account codes, private contact details, storage keys, or signed URLs.
- Real browser end-to-end tests and operational monitoring remain future work.
- Secrets, private access codes, real member information, and private media must never be committed to the repository.
