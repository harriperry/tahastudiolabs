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


## Phase 3: Growth Department proposals and the client Inbox

The team prepares drafts for a client. The client reviews them in their panel and approves,
edits then approves, requests changes or rejects. Approval creates an approved version and a
scheduled job through the existing engine, so consent, the enabled switch, pauses and the daily
cap all still apply. Nothing publishes without the client's approval.

Routes (all under /api/vault/social):
- POST /proposals (admin): body { clientId, items: [{ platform, body, mediaUrl?, linkUrl?, accountId?, suggestedRunAt? }] }, up to 20 per batch, all or nothing.
- POST /proposals/decide (client): body { proposalId, action: approve | changes | reject, note?, body?, accountId?, runAt? }.
- POST /proposals/withdraw (admin): body { clientId, proposalId }.
- GET /status now also returns proposals.

Settings: SOCIAL_PROPOSAL_DAYS (default 14, unanswered proposals expire), SOCIAL_MAX_PENDING (default 20 per client), NOTIFY_EMAIL (team address, default the first ADMIN_EMAILS entry), MAIL_FROM (default TAHA Studio Labs <hej@tahastudiolabs.com>).

Secret to add before the notification emails work: RESEND_API_KEY on the social-hub Worker (Cloudflare dashboard, Settings, Variables and Secrets, type Secret). Without it everything still works and the email is simply skipped (audited as proposals_notify_skipped).

Emails never contain post text, are always Swedish and English, and contain no em-dashes.

## Image step (Instagram and Facebook images)

An admin uploads an original image (JPG, PNG or WebP, up to 8 MB) from the panel. It is stored
in R2 under social-media/ and the panel fills the post's image field with a public link on our
own domain. That link serves the image converted for the platforms: JPEG, at most 1440 px on the
long edge, and always inside Instagram's ratio range (0.8 to 1.91). Images outside the range are
padded (black by default, set SOCIAL_PAD_COLOR to change), never cropped. The client's Inbox
shows the image, so the client sees exactly what they approve.

Routes (under /api/vault/social):
- POST /media (admin): raw image bytes in the request body. Returns { url, bytes }.
- GET /media/<id>.jpg (public, random id): the converted image. Needs no session because Meta must fetch it.

Needs the Images binding (IMAGES, in wrangler.json). Cost: Cloudflare Images transformations are free up to 5,000 unique per month, then $0.50 per 1,000. Without the binding the route answers 503 and never serves an unconverted original.
