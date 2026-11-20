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

  await ensureSchema(env);
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
    return json({
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
    if (r.error) return json({ error: r.error }, 400);
    return json({ ok: true, accountId: r.accountId, displayName: r.displayName });
  }

  if (path === "/accounts/revoke" && method === "POST") {
    const ok = await revokeAccount(env, { clientId, accountId: String(body.accountId || ""), actor: auth.email });
    return ok ? json({ ok: true }) : json({ error: "not_found" }, 404);
  }

  if (path === "/versions" && method === "POST") {
    const text = typeof body.body === "string" ? body.body.trim() : "";
    const platform = String(body.platform || "");
    if (!text || text.length > 5000 || !platform) return json({ error: "bad_request" }, 400);
    const id = newId("sv");
    await env.DB.prepare(
      "INSERT INTO social_versions (id, client_id, platform, body, status, created_by, created_at) VALUES (?, ?, ?, ?, 'draft', ?, ?)"
    ).bind(id, clientId, platform, text, auth.email, nowIso()).run();
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
