/* social-hub: the Social Distribution Engine Worker. Separate from brain-vault so a problem
   here can never affect the Growth Department app, its landing pages or its daily sweeps.
   Routes live under /api/vault/social/. Everything is tenant scoped by client_id. */
import { actingClientId, getAuth, originOk } from "./auth.js";
import { audit } from "./audit.js";
import { currentVersion, hasConsent, recordConsent } from "./consent.js";
import { hasTokenKey } from "./crypto.js";
import { ensureSchema } from "./db.js";
import { getSwitches, setClientFlags, setGlobalPause } from "./killswitch.js";
import { completeOAuth, revokeAccount, startOAuth } from "./oauth.js";
import { parseSignedRequest } from "./connectors/meta.js";
import { PANEL_CSS, PANEL_HEADERS, PANEL_HTML, PANEL_JS } from "./panel.js";
import { cancelJob, createJob, processJob, tick } from "./queue.js";
import { json, newId, nowIso } from "./util.js";

const BASE = "/api/vault/social";

async function readJson(request) {
  try {
    const b = await request.json();
    return b && typeof b === "object" ? b : {};
  } catch (e) {
    return {};
  }
}

function redirectUriFor(env, platform) {
  return (env.SITE_ORIGIN || "https://tahastudiolabs.com") + BASE + "/oauth/callback/" + platform;
}

export async function handle(request, env) {
  const url = new URL(request.url);
  if (!url.pathname.startsWith(BASE)) return json({ error: "not_found" }, 404);
  const path = url.pathname.slice(BASE.length) || "/";
  const method = request.method;

  if (path === "/health" && method === "GET") {
    return json({ ok: true, service: "social-hub", tokenKey: hasTokenKey(env) });
  }

  /* Static panel files: no data, no session needed (the page itself calls the API with the cookie). */
  const panelFiles = {
    "/panel": [PANEL_HTML, "text/html; charset=utf-8"],
    "/panel.js": [PANEL_JS, "application/javascript; charset=utf-8"],
    "/panel.css": [PANEL_CSS, "text/css; charset=utf-8"]
  };
  if (method === "GET" && panelFiles[path]) {
    return new Response(panelFiles[path][0], { headers: { ...PANEL_HEADERS, "Content-Type": panelFiles[path][1] } });
  }

  await ensureSchema(env);

  /* Meta calls these without a session; the signed_request proves it is Meta. */
  if ((path === "/meta/data-deletion" || path === "/meta/deauthorize") && method === "POST") {
    let signed = "";
    try { signed = String((await request.formData()).get("signed_request") || ""); } catch (e) {}
    const sr = await parseSignedRequest(signed, env.META_APP_SECRET);
    if (!sr) return json({ error: "bad_signature" }, 400);
    const rows = await env.DB.prepare("SELECT id, client_id FROM social_accounts WHERE provider_user_id = ?").bind(sr.userId).all();
    for (const r of rows.results || []) {
      await revokeAccount(env, { clientId: r.client_id, accountId: r.id, actor: "meta" });
    }
    const code = newId("del");
    await audit(env, { clientId: null, actor: "meta", action: path === "/meta/data-deletion" ? "data_deletion_request" : "deauthorized", detail: { code, accounts: (rows.results || []).length } });
    return json({ url: (env.SITE_ORIGIN || "https://tahastudiolabs.com") + BASE + "/panel?deletion=" + code, confirmation_code: code });
  }

  const auth = await getAuth(request, env);
  if (!auth) return json({ error: "unauthorized" }, 401);
  if (method !== "GET" && !originOk(request, env)) return json({ error: "bad_origin" }, 403);

  /* Admin only: kill switch and per-client flag. */
  if (path === "/admin/pause" && method === "POST") {
    if (auth.role !== "admin") return json({ error: "forbidden" }, 403);
    const b = await readJson(request);
    await setGlobalPause(env, b.paused === true, auth.email);
    return json({ ok: true });
  }
  if (path === "/admin/client" && method === "POST") {
    if (auth.role !== "admin") return json({ error: "forbidden" }, 403);
    const b = await readJson(request);
    if (typeof b.clientId !== "string" || !b.clientId) return json({ error: "client_required" }, 400);
    const exists = await env.DB.prepare("SELECT id FROM clients WHERE id = ?").bind(b.clientId).first();
    if (!exists) return json({ error: "not_found" }, 404);
    await setClientFlags(env, b.clientId, { enabled: b.enabled, paused: b.paused }, auth.email);
    return json({ ok: true });
  }

  const body = method === "GET" ? {} : await readJson(request);
  const clientId = actingClientId(auth, method === "GET" ? url.searchParams.get("clientId") : body.clientId);
  if (!clientId) return json({ error: "client_required" }, 400);

  if (path === "/status" && method === "GET") {
    const accounts = await env.DB.prepare(
      "SELECT id, platform, display_name, status, token_expires_at AS expires_at FROM social_accounts WHERE client_id = ? ORDER BY created_at"
    ).bind(clientId).all();
    const jobs = await env.DB.prepare(
      "SELECT id, platform, run_at, status, attempts, last_error FROM social_jobs WHERE client_id = ? ORDER BY run_at DESC LIMIT 50"
    ).bind(clientId).all();
    const versions = await env.DB.prepare(
      "SELECT id, platform, body, status, media_url, link_url FROM social_versions WHERE client_id = ? ORDER BY created_at DESC LIMIT 30"
    ).bind(clientId).all();
    return json({
      role: auth.role,
      versions: versions.results || [],
      consentVersion: currentVersion(env),
      consented: await hasConsent(env, clientId),
      switches: await getSwitches(env, clientId),
      accounts: accounts.results || [],
      jobs: jobs.results || []
    });
  }

  if (path === "/consent" && method === "POST") {
    if (auth.role !== "client") return json({ error: "forbidden" }, 403);
    await recordConsent(env, clientId, auth.email);
    return json({ ok: true });
  }

  if (path === "/oauth/start" && method === "POST") {
    if (auth.role !== "client") return json({ error: "forbidden" }, 403);
    if (!(await hasConsent(env, clientId))) return json({ error: "consent_required" }, 409);
    const platform = String(body.platform || "");
    const r = await startOAuth(env, { clientId, platform, sessionHash: auth.sessionHash, redirectUri: redirectUriFor(env, platform) });
    return r.error ? json({ error: r.error }, 400) : json({ url: r.url });
  }

  const cb = path.match(/^\/oauth\/callback\/([a-z0-9_-]{1,30})$/);
  if (cb && method === "GET") {
    const platform = cb[1];
    const r = await completeOAuth(env, {
      state: url.searchParams.get("state"), code: url.searchParams.get("code"), platform,
      sessionHash: auth.sessionHash, redirectUri: redirectUriFor(env, platform)
    });
    const wantsJson = (request.headers.get("Accept") || "").includes("application/json");
    if (!wantsJson) {
      const to = BASE + "/panel?" + (r.error ? "error=" + encodeURIComponent(r.error) : "connected=" + r.count);
      return new Response(null, { status: 302, headers: { Location: to } });
    }
    if (r.error) return json({ error: r.error }, 400);
    return json({ ok: true, accountId: r.accountId, count: r.count, displayName: r.displayName });
  }

  if (path === "/accounts/revoke" && method === "POST") {
    const ok = await revokeAccount(env, { clientId, accountId: String(body.accountId || ""), actor: auth.email });
    return ok ? json({ ok: true }) : json({ error: "not_found" }, 404);
  }

  if (path === "/versions" && method === "POST") {
    const text = typeof body.body === "string" ? body.body.trim() : "";
    const platform = String(body.platform || "");
    if (!text || text.length > 5000 || !platform) return json({ error: "bad_request" }, 400);
    const httpsUrl = (v) => {
      if (v === undefined || v === null || v === "") return null;
      try { const u = new URL(String(v)); return u.protocol === "https:" && String(v).length <= 2000 ? u.toString() : false; } catch (e) { return false; }
    };
    const linkUrl = httpsUrl(body.linkUrl);
    const mediaUrl = httpsUrl(body.mediaUrl);
    if (linkUrl === false || mediaUrl === false) return json({ error: "bad_url" }, 400);
    if (platform === "instagram" && !mediaUrl) return json({ error: "media_required" }, 400);
    const id = newId("sv");
    await env.DB.prepare(
      "INSERT INTO social_versions (id, client_id, platform, body, status, created_by, created_at, media_url, link_url) VALUES (?, ?, ?, ?, 'draft', ?, ?, ?, ?)"
    ).bind(id, clientId, platform, text, auth.email, nowIso(), mediaUrl, linkUrl).run();
    await audit(env, { clientId, actor: auth.email, action: "version_created", detail: { versionId: id } });
    return json({ versionId: id });
  }

  if (path === "/versions/approve" && method === "POST") {
    if (auth.role !== "client") return json({ error: "forbidden" }, 403);
    const r = await env.DB.prepare(
      "UPDATE social_versions SET status = 'approved', approved_at = ?, approved_by = ? WHERE id = ? AND client_id = ? AND status = 'draft'"
    ).bind(nowIso(), auth.email, String(body.versionId || ""), clientId).run();
    if (!(r.meta && r.meta.changes === 1)) return json({ error: "not_found" }, 404);
    await audit(env, { clientId, actor: auth.email, action: "version_approved", detail: { versionId: body.versionId } });
    return json({ ok: true });
  }

  if (path === "/jobs" && method === "POST") {
    const r = await createJob(env, {
      clientId, accountId: String(body.accountId || ""), versionId: String(body.versionId || ""),
      runAt: body.runAt, actor: auth.email
    });
    return r.error ? json({ error: r.error }, 400) : json({ jobId: r.jobId });
  }

  if (path === "/jobs/cancel" && method === "POST") {
    const ok = await cancelJob(env, { clientId, jobId: String(body.jobId || ""), actor: auth.email });
    return ok ? json({ ok: true }) : json({ error: "not_found" }, 404);
  }

  return json({ error: "not_found" }, 404);
}

export default {
  async fetch(request, env) {
    try {
      return await handle(request, env);
    } catch (e) {
      /* Never echo internals, tokens or client content. */
      return json({ error: "server_error" }, 500);
    }
  },
  async scheduled(event, env, ctx) {
    await ensureSchema(env);
    ctx.waitUntil(tick(env));
  },
  async queue(batch, env) {
    await ensureSchema(env);
    for (const msg of batch.messages) {
      const id = msg.body && msg.body.jobId;
      if (typeof id === "string") await processJob(env, id);
      msg.ack();
    }
  }
};
