# TAHA Studio Labs — Site + ScriptForge v7: Setup Guide

Multi-product site: `/` landing + `/products.html` + `/scriptforge/` (the app).
Future products = new folders; all share the same accounts/checkout backend.

Upgrade of TAHA STUDIO AI ScriptForge implementing the Feature Scope + Auth/Security Brief.
Architecture: static front end + Cloudflare Pages Functions + Supabase (auth & minimal DB) + Polar (Merchant of Record).

**Trust model preserved:** the Anthropic API key and all script content stay in the browser.
The backend only ever sees: email, credential (hashed by Supabase), subscription status,
license redemption records, session ids. Verified against Security Brief §10 below.

---

## 1. What's in this folder

| Path | Purpose |
|---|---|
| `index.html`, `assets/app.css`, `assets/app.js` | The app (v6 features + accounts, gating, library export/import) |
| `assets/jspdf.umd.min.js` | jsPDF self-hosted (allows strict CSP `script-src 'self'`, no SRI needed) |
| `privacy.html`, `terms.html` | Legal pages, linked in footer + signup (Terms is a PLACEHOLDER — review before launch) |
| `_headers` | CSP, HSTS, and security headers (Brief §6) — applied automatically by Cloudflare Pages |
| `functions/api/*.js` | Backend: signup, login, magic, session-from-token, logout, me, redeem, webhook-polar, delete-account |
| `supabase-schema.sql` | The three tables + RLS lockdown |

## 2. Create the Supabase project (~10 min)

1. supabase.com → New project (free tier). Region: EU if you want EU data residency for GDPR optics.
2. SQL Editor → paste and run `supabase-schema.sql`.
3. Authentication → Providers → Email: enable, **turn ON "Confirm email"**.
4. Authentication → URL Configuration → Site URL: `https://tahastudiolabs.com/scriptforge/`.
5. Note down: Project URL, `anon` key, `service_role` key (Settings → API).

## 3. Create the Polar account (~15 min)

1. polar.sh → create organization → create a product (e.g. "ScriptForge Pro", one-time or subscription — placeholder pricing is fine per scope §3).
2. Enable **license keys** on the product (limit: 1 activation).
3. Create a checkout link → paste it into `assets/app.js` at `CHECKOUT_URL`.
4. Settings → Webhooks → add endpoint `https://tahastudiolabs.com/api/webhook-polar`, subscribe to order + subscription + refund events, copy the signing secret.
5. ⚠ `functions/api/redeem.js` calls Polar's license validation endpoint — confirm the exact path/payload against current Polar API docs and adjust if it has changed.

## 4. Deploy to Cloudflare Pages (~15 min)

1. Push this folder to a GitHub repo (private is fine) → Cloudflare dashboard → Workers & Pages → Create → Pages → connect the repo. No build command; output dir = root.
2. Custom domain: add `tahastudiolabs.com` (move DNS to Cloudflare if not already).
3. Settings → Environment variables (Production):

| Variable | Value |
|---|---|
| `SUPABASE_URL` | your project URL |
| `SUPABASE_ANON_KEY` | anon key |
| `SUPABASE_SERVICE_ROLE_KEY` | service role key (secret) |
| `POLAR_ORGANIZATION_ID` | from Polar settings |
| `POLAR_WEBHOOK_SECRET` | from step 3.4 |
| `SITE_URL` | `https://tahastudiolabs.com/scriptforge/` |
| `SESSION_LIMIT` | `2` |

4. **Rate limiting (Brief §2):** Cloudflare dashboard → Security → WAF → Rate limiting rules:
   - `/api/login` and `/api/magic`: 5 requests / minute / IP → block 10 min.
   - `/api/redeem`: 10 requests / hour / IP.

## 5. Free vs paid wiring (as decided)

- **Free, no login:** Mock Test, real formatting up to 3 segments, copy output, Library up to 5 saves.
- **Pro (server-verified):** 6–30 segments, PDF export, unlimited Library.
- Gating flow: browser calls `GET /api/me` (httpOnly cookie session) → server checks the
  `subscriptions` row → client enables features. **Documented limitation** (flagged during
  scoping): because formatting/PDF run client-side on content the server must never see,
  a dev-tools user can invoke the client code paths; the server-side check gates entitlement,
  not code execution. This is the accepted trade-off of the no-content-on-server architecture.

## 6. GDPR / policy consistency

- Account deletion (`/api/delete-account`) removes email, credential, subscription, redemption
  and session records immediately (policy allows 30 days; we do it instantly). Payment records
  remain with Polar under its own MoR compliance — matches Privacy Policy §8.
- Only cookies set: `sf_at`, `sf_rt`, `sf_sid` — strictly necessary session cookies (httpOnly,
  Secure, SameSite=Strict). **No cookie banner needed** under scope §E. If you ever add
  analytics, add consent first.
- Fill in `[SUPPORT EMAIL]` in `privacy.html` and finish `terms.html` before launch.
- Sub-processors to name in the policy: Supabase (auth/data), Polar (payments), Cloudflare (hosting).

## 7. Acceptance criteria (Security Brief §10) — how to verify

1. **DB contents:** Supabase Table Editor → confirm only the three tables + auth.users exist; no content columns.
2. **API key never touches our domain:** DevTools → Network during a real format → the key appears only in the request to `api.anthropic.com`; zero requests to `tahastudiolabs.com/api/*` carry it.
3. **Dev-tools gating:** while signed out, edit `tier` in the console → UI may unlock, but `/api/me` still returns 401 and no entitlement exists server-side (documented client-execution limitation in §5 above).
4. **Local-only library:** save scripts → clear site data → library is empty; no server copy.
5. **Deletion:** create test account → buy/redeem test license (Polar sandbox) → delete account → confirm rows gone in all three tables and auth.users.

## 8. Migration note

Keep the GitHub Pages version live until the Cloudflare deployment is verified, then make the
old URL a redirect (or retire it). localStorage does not transfer across domains — tell existing
users to use **Export JSON** on the old domain and **Import JSON** on tahastudiolabs.com.
