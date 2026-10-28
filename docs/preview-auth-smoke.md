# Temporary branch to refresh Cloudflare Worker Preview secrets

This branch was copied from feature/member-conductor-auth at commit 953b459b63da671f8524aacdebfb4f2f4281801f.

Purpose:
- Create a fresh Cloudflare Preview after Previews Base secrets were configured.
- Verify that the Preview receives AUTH_SECRET and BOOTSTRAP_SETUP_KEY without changing production.
- Do not merge this temporary branch into main.

The application code is otherwise unchanged from the authentication feature branch.
