# Choir App — Corul Tabor

Private source repository for the Choir App web application.

## Product goals

- Mobile-first song catalog for choir members.
- Each member has a saved voice part: Soprano, Alto, Tenor, or Bass.
- Each song may have a PDF, audio, and video for each voice.
- Conductors will manage their choir, member invitations, activation codes, and published assets.
- The data model supports multiple choirs. Catalog queries must always be scoped to a choir.

## Current status

This is an initial foundation, not a production-ready member service. The responsive UI and base schema exist. Account activation, session authentication, role enforcement, conductor screens, private asset delivery, upload/publish tools, rate limiting, monitoring, and end-to-end tests still need implementation and validation.

## Stack

- Cloudflare Workers (TypeScript)
- Cloudflare Workers Static Assets
- Cloudflare D1 for relational metadata
- Cloudflare R2 for media
- GitHub Actions + Wrangler for deploys when explicitly enabled

## Local development

Requirements: Node.js LTS and npm.

Install dependencies with npm install, then start the development server with npm run dev.

Type-check the Worker with npm run typecheck.

## Cloudflare setup

1. In the dedicated Cloudflare account, configure the workers.dev subdomain as tabor if available.
2. Create a D1 database, then uncomment its binding in wrangler.toml and replace the placeholder with the real database ID.
3. Apply migrations with: npx wrangler d1 migrations apply choir-app-db --remote
4. Create R2 buckets and add their bindings to wrangler.toml once the bucket names and account are confirmed.
5. Configure the repository Actions secrets CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID.
6. Only after staging checks and bindings are ready, set the repository Actions variable ENABLE_CLOUDFLARE_DEPLOY to true to enable the deploy step.

Do not configure Cloudflare's native GitHub deployment for this repository if the same GitHub account is already integrated with another Cloudflare account. Use the explicit GitHub Actions workflow after its credentials are set up.

## Core design and security rules

- Voice selection is currently saved in the browser for this initial UI; account-backed preference is not implemented yet.
- The catalog uses a shared song record plus separate asset records by song, voice, and format.
- Multi-tenant catalog queries must always be scoped to the resolved choir.
- Private media must never be served directly from a public bucket. Verify the active session and choir permissions before issuing access to private assets.
- Activation codes must be single-use, expiring, rate-limited, revoked when needed, and stored as hashes, never plaintext.
- Store only hashes of session tokens in D1. Cookies and session validation still need implementation and security review.
- Secrets belong in Cloudflare/GitHub secret stores, not in source files.
