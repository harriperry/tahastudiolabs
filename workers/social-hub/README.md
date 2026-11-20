# social-hub (Phase 1)

Separate Cloudflare Worker for the TAHA Social Distribution Engine. It shares the D1 database and
R2 bucket with brain-vault but has its own code, deploys, cron, queue and migrations.

Phase 1 contains no live platform connector. Only a mock connector exists, and it is refused in
production unless SOCIAL_ALLOW_MOCK is "on".

## What is here
- Auth reads the Vault's sessions (client and admin). No login emails, no sessions created here.
- Per-client social consent (SOCIAL_CONSENT_VERSION), separate from the Vault consent.
- OAuth connect flow: single-use hashed state, 10 minute expiry, bound to the session, PKCE.
- Tokens encrypted with AES-GCM (SOCIAL_TOKEN_KEY, a Worker secret only this Worker holds).
- Publishing engine: atomic claim, idempotency key, retry only when nothing was sent, stuck jobs
  go to needs_check and are never resent, failures never shown as published.
- Kill switch: global pause and per-client enable and pause. Publishing is off per client by default.
- Audit log with secret redaction.

## Tests
`node --no-warnings test/run-all.mjs` (no network, no wrangler, needs Node 22 or newer).

## Not done (needs separate approval)
Create the `social-publish` queue (Workers Paid), set the SOCIAL_TOKEN_KEY secret, connect a
Workers Builds project with root /workers/social-hub, deploy, then enable one client.
