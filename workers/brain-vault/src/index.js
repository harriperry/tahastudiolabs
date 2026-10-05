/* Brain Vault: the always-on bridge between the TAHA client portal and ScriptForge.
   Routed at tahastudiolabs.com/api/vault/* (the API) and tahastudiolabs.com/grow/* (the client
   portal pages). Phase 1: login, roles and invites. Phase 2: the client portal.
   Phase 3: admin endpoints behind the ScriptForge Growth Clients panel.
   Phase 4: Business Brain versions (saved from ScriptForge, never built here).
   Phase 5: campaigns from the Campaign Generator, campaign and manual status changes.
   Phase 6: GDPR tools (full export, erase now, leaving and the 6 month retention rule).

   House rules enforced here:
   1. The Vault never receives, stores or logs an LLM API key. No endpoint accepts one.
   2. No client business content is written to logs or notification emails.
   3. Admin endpoints check the admin role; client endpoints check the session's own client id.
   4. Every state-changing request must come from the TAHA site itself (Origin check). */
import { getConfig, STATUS_LABELS } from "./config.js";
import { ensureSchema } from "./db.js";
import {
  checkRateLimit,
  cleanup,
  clearSessionCookie,
  consumeToken,
  createSession,
  destroySession,
  getAuth,
  issueLoginLink,
  sessionCookie
} from "./auth.js";
import { createClient, getIntakeAdmin, listClients, markSeen, resendInvite } from "./admin.js";
import { getBrains, getBrainVersion, saveBrain } from "./brain.js";
import { getCampaign, listCampaigns, saveCampaign, setCampaignStatus, setManualStatus } from "./campaign.js";
import { eraseNow, exportClient, retentionSweep, setLeft } from "./gdpr.js";
import {
  deleteFile,
  getFile,
  getIntake,
  getStatus,
  portalState,
  postConsent,
  postUpload,
  putIntake,
  putLanguage,
  submitIntake
} from "./portal.js";
import { SCHEMAS } from "./schemas.js";
import { json, lang, normEmail, readJson, validEmail, withCookies } from "./util.js";

import verifyHtml from "./public/verify.html";
import verifyJs from "./public/verify.js";
import consoleHtml from "./public/console.html";
import consoleJs from "./public/console.js";
import vaultCss from "./public/vault.css";
import portalHtml from "./public/portal.html";
import portalJs from "./public/portal.js";
import portalCss from "./public/portal.css";
import i18n from "./public/i18n.json";

const MSG = {
  neutral: {
    sv: "Om e-postadressen finns hos oss har vi skickat en inloggningslänk. Kolla din inkorg.",
    en: "If this email address is registered with us, we have sent a login link. Check your inbox."
  },
  invalidEmail: { sv: "Skriv en giltig e-postadress.", en: "Enter a valid email address." },
  rateLimited: {
    sv: "För många försök. Vänta en stund och försök igen.",
    en: "Too many attempts. Please wait a while and try again."
  },
  badLink: {
    sv: "Länken är ogiltig, redan använd eller har gått ut. Begär en ny länk.",
    en: "This link is invalid, already used or expired. Request a new link."
  },
  notSignedIn: { sv: "Du är inte inloggad.", en: "You are not signed in." },
  forbidden: { sv: "Du har inte behörighet.", en: "You do not have access." },
  badOrigin: { sv: "Förfrågan nekades.", en: "Request refused." },
  notFound: { sv: "Hittades inte.", en: "Not found." },
  server: { sv: "Något gick fel hos oss. Försök igen.", en: "Something went wrong on our side. Please try again." }
};

const PAGE_CSP =
  "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'";

function page(body) {
  return new Response(body, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "Content-Security-Policy": PAGE_CSP,
      "X-Content-Type-Options": "nosniff",
      "X-Frame-Options": "DENY",
      "Referrer-Policy": "same-origin",
      "X-Robots-Tag": "noindex, nofollow"
    }
  });
}

function asset(body, type) {
  return new Response(body, {
    headers: {
      "Content-Type": type,
      "Cache-Control": "public, max-age=300",
      "X-Content-Type-Options": "nosniff"
    }
  });
}

/* The client portal: one page, its script, styles and the i18n dictionary, served at /grow/. */
function servePortal(path) {
  if (path === "/grow/portal.js") return asset(portalJs, "text/javascript; charset=utf-8");
  if (path === "/grow/portal.css") return asset(portalCss, "text/css; charset=utf-8");
  if (path === "/grow/i18n.json") return asset(JSON.stringify(i18n), "application/json; charset=utf-8");
  return page(portalHtml);
}

/* A state-changing request must come from the TAHA site itself. Browsers send Origin on
   these requests; Sec-Fetch-Site is a header pages cannot forge and covers browsers that send
   "Origin: null" under a strict referrer policy. */
function sameOrigin(request, cfg) {
  const origin = request.headers.get("Origin");
  if (origin === cfg.siteOrigin) return true;
  return (!origin || origin === "null") && request.headers.get("Sec-Fetch-Site") === "same-origin";
}

async function handle(request, env, ctx) {
  const cfg = getConfig(env);
  const url = new URL(request.url);
  if ((url.pathname === "/grow" || url.pathname.startsWith("/grow/")) && (request.method === "GET" || request.method === "HEAD")) {
    if (url.pathname === "/grow") return Response.redirect(cfg.siteOrigin + "/grow/", 301);
    return servePortal(url.pathname);
  }
  if (!url.pathname.startsWith(cfg.basePath + "/") && url.pathname !== cfg.basePath) {
    return json({ error: "not_found", message: MSG.notFound }, 404);
  }
  const path = url.pathname.slice(cfg.basePath.length) || "/";
  const method = request.method.toUpperCase();

  /* Static, no database needed. */
  if (method === "GET") {
    if (path === "/assets/vault.css") return asset(vaultCss, "text/css; charset=utf-8");
    if (path === "/assets/verify.js") return asset(verifyJs, "text/javascript; charset=utf-8");
    if (path === "/assets/console.js") return asset(consoleJs, "text/javascript; charset=utf-8");
    if (path === "/auth/verify") return page(verifyHtml);
    if (path === "/console" || path === "/") return page(consoleHtml);
    const sm = path.match(/^\/schemas\/(intake|brain|campaign)(\.schema\.json)?$/);
    if (sm) return json(SCHEMAS[sm[1]], 200, { "Cache-Control": "public, max-age=300" });
  }

  if (method !== "GET" && method !== "HEAD" && !sameOrigin(request, cfg)) {
    return json({ error: "bad_origin", message: MSG.badOrigin }, 403);
  }

  await ensureSchema(env);

  if (method === "GET" && path === "/health") {
    const db = await env.DB.prepare("SELECT 1 AS ok").first();
    return json({ ok: !!db, db: !!db, files: !!env.FILES, phase: 6 });
  }

  if (method === "GET" && path === "/portal/meta") {
    return json({ productName: cfg.productName, contactEmail: cfg.tahaEmail });
  }

  /* ---------- auth ---------- */
  if (method === "POST" && path === "/auth/request-link") {
    const b = await readJson(request, 4096);
    const email = normEmail(b && b.email);
    if (!validEmail(email)) return json({ error: "invalid_email", message: MSG.invalidEmail }, 400);
    const ip = request.headers.get("CF-Connecting-IP") || "unknown";
    const allowed = await checkRateLimit(env, cfg, email, ip);
    if (!allowed) return json({ error: "rate_limited", message: MSG.rateLimited }, 429, { "Retry-After": "3600" });
    ctx.waitUntil(issueLoginLink(env, cfg, email, lang(b && b.lang)).catch((e) => console.error("issue link: " + e.message)));
    return json({ ok: true, message: MSG.neutral });
  }

  if (method === "POST" && path === "/auth/verify") {
    const b = await readJson(request, 1024);
    const row = await consumeToken(env, b && typeof b.t === "string" ? b.t : "");
    if (!row) return json({ error: "bad_link", message: MSG.badLink }, 400);
    if (row.role === "client") {
      const c = await env.DB.prepare("SELECT id FROM clients WHERE id = ? AND email = ? AND left_at IS NULL").bind(row.client_id, row.email).first();
      if (!c) return json({ error: "bad_link", message: MSG.badLink }, 400);
    }
    await destroySession(env, request);
    const token = await createSession(env, cfg, { role: row.role, clientId: row.client_id, email: row.email });
    const redirect = row.role === "admin" ? cfg.adminHome : cfg.clientHome;
    return json({ ok: true, role: row.role, redirect }, 200, { "Set-Cookie": sessionCookie(cfg, token) });
  }

  if (method === "POST" && path === "/auth/logout") {
    await destroySession(env, request);
    return json({ ok: true }, 200, { "Set-Cookie": clearSessionCookie() });
  }

  const auth = await getAuth(request, env, cfg);
  const respond = (r) => withCookies(r, auth ? auth.setCookies : []);

  if (method === "GET" && path === "/auth/me") {
    if (!auth) return json({ role: null, message: MSG.notSignedIn }, 401);
    const out = { role: auth.role, email: auth.email, via: auth.via };
    if (auth.role === "client") {
      const c = await env.DB.prepare("SELECT id, name, status, language FROM clients WHERE id = ?").bind(auth.clientId).first();
      if (!c) return json({ role: null, message: MSG.notSignedIn }, 401, { "Set-Cookie": clearSessionCookie() });
      out.client = { id: c.id, name: c.name, status: c.status, statusLabel: STATUS_LABELS[c.status], language: c.language };
    }
    return respond(json(out));
  }

  /* ---------- client portal ---------- */
  const clientPaths = ["/portal/state", "/consent", "/intake", "/uploads", "/intake/submit", "/status", "/me/language"];
  const fileMatch = path.match(/^\/files\/(f_[a-z0-9]{4,32})$/);
  if (clientPaths.includes(path) || fileMatch) {
    if (!auth) return json({ error: "not_signed_in", message: MSG.notSignedIn }, 401);
    if (fileMatch && method === "GET") return respond(await getFile(env, auth, fileMatch[1]));
    if (auth.role !== "client") return json({ error: "forbidden", message: MSG.forbidden }, 403);
    if (fileMatch && method === "DELETE") return deleteFile(env, auth, fileMatch[1]);
    if (path === "/portal/state" && method === "GET") return portalState(env, cfg, auth);
    if (path === "/consent" && method === "POST") return postConsent(request, env, cfg, auth);
    if (path === "/intake" && method === "GET") return getIntake(env, cfg, auth);
    if (path === "/intake" && method === "PUT") return putIntake(request, env, cfg, auth);
    if (path === "/uploads" && method === "POST") return postUpload(request, env, cfg, auth, url);
    if (path === "/intake/submit" && method === "POST") return submitIntake(env, cfg, auth, ctx);
    if (path === "/status" && method === "GET") return getStatus(env, auth);
    if (path === "/me/language" && method === "PUT") return putLanguage(request, env, auth);
  }

  /* ---------- admin ---------- */
  /* ScriptForge asks this on page load to decide whether to show the Growth Clients button.
     Always 200 so public visitors get a quiet {admin:false} and nothing else. */
  if (method === "GET" && path === "/admin/check") {
    return respond(json({ admin: !!auth && auth.role === "admin" }));
  }
  if (path === "/admin" || path.startsWith("/admin/")) {
    if (!auth) return json({ error: "not_signed_in", message: MSG.notSignedIn }, 401);
    if (auth.role !== "admin") return json({ error: "forbidden", message: MSG.forbidden }, 403);
    if (path === "/admin/clients" && method === "GET") return respond(await listClients(env));
    if (path === "/admin/clients" && method === "POST") return respond(await createClient(request, env, cfg));
    const inv = path.match(/^\/admin\/clients\/(cl_[a-z0-9]{4,32})\/invite$/);
    if (inv && method === "POST") return respond(await resendInvite(env, cfg, inv[1]));
    const seen = path.match(/^\/admin\/clients\/(cl_[a-z0-9]{4,32})\/seen$/);
    if (seen && method === "POST") return respond(await markSeen(request, env, seen[1]));
    const br = path.match(/^\/admin\/brain\/(cl_[a-z0-9]{4,32})(?:\/([0-9]{1,6}))?$/);
    if (br && method === "POST" && !br[2]) return respond(await saveBrain(request, env, br[1]));
    if (br && method === "GET" && !br[2]) return respond(await getBrains(env, br[1]));
    if (br && method === "GET" && br[2]) return respond(await getBrainVersion(env, br[1], parseInt(br[2], 10)));
    const cpl = path.match(/^\/admin\/campaigns\/(cl_[a-z0-9]{4,32})$/);
    if (cpl && method === "GET") return respond(await listCampaigns(env, cpl[1]));
    const cps = path.match(/^\/admin\/campaign\/(cl_[a-z0-9]{4,32})$/);
    if (cps && method === "POST") return respond(await saveCampaign(request, env, cps[1]));
    const cp = path.match(/^\/admin\/campaign\/(cl_[a-z0-9]{4,32})\/(cp_[a-z0-9_]{2,40})(\/status)?$/);
    if (cp && method === "GET" && !cp[3]) return respond(await getCampaign(env, cp[1], cp[2]));
    if (cp && method === "PATCH" && cp[3]) return respond(await setCampaignStatus(request, env, cp[1], cp[2]));
    const ms = path.match(/^\/admin\/status\/(cl_[a-z0-9]{4,32})$/);
    if (ms && method === "PATCH") return respond(await setManualStatus(request, env, ms[1]));
    const ex = path.match(/^\/admin\/export\/(cl_[a-z0-9]{4,32})$/);
    if (ex && method === "GET") return respond(await exportClient(env, cfg, ex[1]));
    const lf = path.match(/^\/admin\/clients\/(cl_[a-z0-9]{4,32})\/left$/);
    if (lf && method === "POST") return respond(await setLeft(request, env, cfg, lf[1]));
    const er = path.match(/^\/admin\/clients\/(cl_[a-z0-9]{4,32})$/);
    if (er && method === "DELETE") return respond(await eraseNow(request, env, er[1]));
    const ai = path.match(/^\/admin\/intake\/(cl_[a-z0-9]{4,32})$/);
    if (ai && method === "GET") return respond(await getIntakeAdmin(env, ai[1]));
  }

  return json({ error: "not_found", message: MSG.notFound }, 404);
}

export default {
  async fetch(request, env, ctx) {
    try {
      return await handle(request, env, ctx);
    } catch (e) {
      console.error("vault error: " + (e && e.message ? e.message : "unknown"));
      return json({ error: "server", message: MSG.server }, 500);
    }
  },
  async scheduled(event, env, ctx) {
    await ensureSchema(env);
    ctx.waitUntil(cleanup(env));
    /* Phase 6: erase clients who left more than RETENTION_MONTHS ago. */
    ctx.waitUntil(retentionSweep(env, getConfig(env)).catch(() => console.error("retention sweep failed")));
  }
};
