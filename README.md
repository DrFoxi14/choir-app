# Choir App — Corul Tabor

Private source repository for the Choir App web application.

## Product goals

- Mobile-first catalog for choir members.
- Each member has a saved voice part: Soprano, Alto, Tenor, or Bass.
- Every song can expose the available PDF, audio, and video for that member's assigned voice.
- Conductor tools will manage their choir, member invitations, activation codes, and published assets.
- The platform is designed for multiple choirs, with server-enforced tenant isolation.

## Current status

This repository is the initial foundation. Do not treat it as production-ready yet: user accounts, activation codes, authorization, storage configuration, monitoring, and end-to-end tests still need implementation and validation.

## Stack

- Cloudflare Workers (TypeScript)
- Static Assets for the web UI
- Cloudflare D1 for relational metadata
- Cloudflare R2 for media objects
- GitHub Actions + Wrangler for deploys after Cloudflare credentials are configured as repository secrets

## Local development

Requirements: Node.js LTS and npm.

```bash
npm install
npm run dev
```

To check TypeScript:

```bash
npm run typecheck
```

## Cloudflare setup

1. Create a Worker named `cor` in the Cloudflare account whose `workers.dev` subdomain is `tabor`.
2. Create a D1 database and apply the migrations in `migrations/`.
3. Create the required R2 buckets and bind them to the Worker after confirming the names and account.
4. Update `wrangler.toml` with the real D1 database ID and configured resource bindings; do not commit account secrets or API tokens.
5. For GitHub Actions deploys, add `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` as repository Actions secrets.
6. Run the security and production checklist before sharing with real choir members.

## Core design rules

- Voice selection is saved once per account/device; it is not asked for every song.
- Catalog entries are shared song records; assets are linked by song, voice, and format.
- Private media must never be served directly from public buckets. Verify member/choir permissions on the server before issuing access to private assets.
- Activation codes must be single-use, expiring, rate-limited, and stored as hashes, never as plaintext.
- Secrets belong in Cloudflare/GitHub secret stores, not in source files.
