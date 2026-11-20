/* Phase 2 suite: Meta connectors against a simulated Graph API (stubbed fetch). No network. */
import { b64url } from "../src/util.js";
import { getConnector } from "../src/connectors/index.js";
import { PANEL_JS } from "../src/panel.js";
import { processJob } from "../src/queue.js";
import { call, counter, makeEnv, makeSession, seedClient } from "./helpers.mjs";
import { handle } from "../src/index.js";

const { ok, done } = counter();
const SECRET = "app-secret-for-tests";
const realFetch = globalThis.fetch;
let graph = { calls: [], handler: null };
globalThis.fetch = async (url, init = {}) => {
  const u = new URL(String(url));
  const params = Object.fromEntries(u.searchParams.entries());
  if (init.body) for (const [k, v] of new URLSearchParams(init.body).entries()) params[k] = v;
  const rec = { method: init.method || "GET", path: u.pathname.replace(/^\/v[\d.]+\//, ""), params };
  graph.calls.push(rec);
  if (!graph.handler) throw new Error("no graph handler");
  const r = await graph.handler(rec);
  if (r instanceof Error) throw r;
  return new Response(JSON.stringify(r.body), { status: r.status || 200, headers: { "Content-Type": "application/json" } });
};

function metaEnv(extra = {}) {
  return makeEnv({ SOCIAL_CONNECTORS: "meta,facebook,instagram", META_APP_ID: "123", META_APP_SECRET: SECRET, META_POLL_MS: "0", ...extra });
}
async function setup(extra) {
  const env = metaEnv(extra);
  await seedClient(env, "cl_a", "a@example.com");
  const a = await makeSession(env, { role: "client", clientId: "cl_a", email: "a@example.com" });
  const admin = await makeSession(env, { role: "admin", email: "admin@example.com" });
  await call(env, "POST", "/admin/client", { cookie: admin, body: { clientId: "cl_a", enabled: true } });
  await call(env, "POST", "/consent", { cookie: a });
  return { env, a, admin };
}
const connectHandler = (r) => {
  if (r.path === "oauth/access_token" && r.params.code) return { body: { access_token: "short" } };
  if (r.path === "oauth/access_token") return { body: { access_token: "long-user-token" } };
  if (r.path === "me") return { body: { id: "u-777" } };
  if (r.path === "me/accounts") return { body: { data: [
    { id: "p1", name: "My Page", access_token: "page-token-1", instagram_business_account: { id: "ig1", username: "mine" } },
    { id: "p2", name: "Other Page", access_token: "page-token-2" } ] } };
  return { status: 404, body: { error: { code: 100, message: "unexpected " + r.path } } };
};
async function connectMeta(env, a) {
  graph.handler = connectHandler;
  const s = await call(env, "POST", "/oauth/start", { cookie: a, body: { platform: "meta" } });
  const state = new URL(s.data.url).searchParams.get("state");
  const cb = await call(env, "GET", "/oauth/callback/meta?state=" + state + "&code=abc", { cookie: a });
  return { s, cb };
}
async function accountId(env, platform) {
  return (await env.DB.prepare("SELECT id FROM social_accounts WHERE platform = ? AND status = 'active'").bind(platform).first()).id;
}
async function queueJob(env, a, platform, extra = {}) {
  const v = await call(env, "POST", "/versions", { cookie: a, body: { platform, body: "Hello", ...extra } });
  await call(env, "POST", "/versions/approve", { cookie: a, body: { versionId: v.data.versionId } });
  const acc = await accountId(env, platform);
  const j = await call(env, "POST", "/jobs", { cookie: a, body: { accountId: acc, versionId: v.data.versionId, runAt: Date.now() + 1000 } });
  return j.data.jobId;
}
const jobRow = (env, id) => env.DB.prepare("SELECT * FROM social_jobs WHERE id = ?").bind(id).first();
const later = Date.now() + 3600000;

/* Connect */
{
  const { env, a } = await setup();
  const { s, cb } = await connectMeta(env, a);
  const u = new URL(s.data.url);
  ok(u.hostname === "www.facebook.com" && u.searchParams.get("client_id") === "123", "auth URL targets Facebook with the app id");
  ok(u.searchParams.get("scope").includes("instagram_content_publish") && u.searchParams.get("scope").includes("pages_manage_posts"), "auth URL asks the publishing scopes");
  ok(u.searchParams.get("redirect_uri") === "https://tahastudiolabs.com/api/vault/social/oauth/callback/meta", "exact redirect URI");
  ok(cb.status === 200 && cb.data.count === 3, "connect stores two Pages and one Instagram account");
  const rows = (await env.DB.prepare("SELECT platform, external_ref, provider_user_id, token_enc FROM social_accounts").all()).results;
  ok(rows.some((r) => r.platform === "instagram" && r.external_ref === "ig1") && rows.every((r) => r.provider_user_id === "u-777"), "accounts carry the provider user id");
  ok(rows.every((r) => !r.token_enc.includes("page-token")), "tokens are stored encrypted");
  ok(graph.calls.filter((c) => c.path === "me/accounts")[0].params.appsecret_proof?.length === 64, "authenticated calls carry appsecret_proof");
  ok(!JSON.stringify(graph.calls.map((c) => c.method === "POST")).includes(SECRET), "app secret never sent as a post body");
  const redirect = await call(env, "GET", "/oauth/callback/meta?state=x&code=y", { cookie: a, accept: "text/html" });
  ok(redirect.status === 302, "browser callback redirects to the panel");
}

/* Facebook publishing */
{
  const { env, a } = await setup();
  await connectMeta(env, a);
  graph.calls = [];
  graph.handler = (r) => ({ body: { id: "p1_100" } });
  const j1 = await queueJob(env, a, "facebook", { linkUrl: "https://example.com/x" });
  await processJob(env, j1, later);
  const c = graph.calls.find((x) => x.path.endsWith("/feed"));
  ok((await jobRow(env, j1)).status === "published" && c && c.params.link === "https://example.com/x" && c.params.message === "Hello", "Facebook link post is published");
  graph.calls = [];
  const j2 = await queueJob(env, a, "facebook", { mediaUrl: "https://example.com/p.jpg" });
  await processJob(env, j2, later);
  ok(graph.calls.some((x) => x.path.endsWith("/photos") && x.params.url === "https://example.com/p.jpg"), "Facebook photo post uses the photos edge");
}

/* Instagram publishing */
{
  const { env, a } = await setup();
  await connectMeta(env, a);
  const mk = (statuses, failPublish) => {
    let i = 0;
    return (r) => {
      if (r.path.endsWith("content_publishing_limit")) return { body: { data: [{ quota_usage: 1 }] } };
      if (r.path.endsWith("/media") && r.method === "POST") return { body: { id: "c1" } };
      if (r.path === "c1") return { body: { status_code: statuses[Math.min(i++, statuses.length - 1)] } };
      if (r.path.endsWith("/media_publish")) return failPublish ? failPublish() : { body: { id: "m9" } };
      if (r.path === "m9") return { body: { permalink: "https://instagram.com/p/x" } };
      return { status: 404, body: { error: { code: 100, message: "x" } } };
    };
  };
  graph.handler = mk(["IN_PROGRESS", "FINISHED"]);
  const j1 = await queueJob(env, a, "instagram", { mediaUrl: "https://example.com/p.jpg" });
  await processJob(env, j1, later);
  ok((await jobRow(env, j1)).status === "published", "Instagram container flow publishes after polling");
  graph.handler = mk(["ERROR"]);
  const j2 = await queueJob(env, a, "instagram", { mediaUrl: "https://example.com/p.jpg" });
  await processJob(env, j2, later);
  ok((await jobRow(env, j2)).status === "failed", "Instagram ERROR status fails without publishing");
  graph.handler = mk(["IN_PROGRESS"]);
  const j3 = await queueJob(env, a, "instagram", { mediaUrl: "https://example.com/p.jpg" });
  await processJob(env, j3, later);
  ok((await jobRow(env, j3)).status !== "published", "an image that is not ready is not published");
  graph.handler = mk(["FINISHED"], () => new Error("socket closed"));
  graph.calls = [];
  const j4 = await queueJob(env, a, "instagram", { mediaUrl: "https://example.com/p.jpg" });
  await processJob(env, j4, later);
  ok((await jobRow(env, j4)).status === "needs_check", "network loss on media_publish becomes needs_check");
  await processJob(env, j4, later + 60000);
  ok(graph.calls.filter((c) => c.path.endsWith("/media_publish")).length === 1, "a needs_check job is never resent");
  graph.handler = mk(["FINISHED"], () => ({ status: 500, body: { error: { code: 2, message: "boom" } } }));
  const j5 = await queueJob(env, a, "instagram", { mediaUrl: "https://example.com/p.jpg" });
  await processJob(env, j5, later);
  ok((await jobRow(env, j5)).status === "needs_check", "5xx on a write becomes needs_check");
}

/* Errors */
{
  const { env, a } = await setup();
  await connectMeta(env, a);
  graph.handler = () => ({ status: 400, body: { error: { code: 190, message: "token" } } });
  const j1 = await queueJob(env, a, "facebook");
  await processJob(env, j1, later);
  const acc = await env.DB.prepare("SELECT status FROM social_accounts WHERE platform = 'facebook' AND external_ref = 'p1'").first();
  ok((await jobRow(env, j1)).status === "failed" && acc.status === "expired", "invalid token fails the job and marks the account expired");
  const { env: e2, a: a2 } = await setup();
  await connectMeta(e2, a2);
  graph.handler = () => ({ status: 400, body: { error: { code: 4, message: "rate" } } });
  const j2 = await queueJob(e2, a2, "facebook");
  await processJob(e2, j2, later);
  ok((await jobRow(e2, j2)).status === "scheduled", "rate limit is retried later");
  const { env: e3, a: a3 } = await setup({ SOCIAL_DAILY_CAP: "1" });
  await connectMeta(e3, a3);
  graph.handler = () => ({ body: { id: "p1_1" } });
  const k1 = await queueJob(e3, a3, "facebook");
  await processJob(e3, k1, later);
  const k2 = await queueJob(e3, a3, "facebook");
  await processJob(e3, k2, later);
  ok((await jobRow(e3, k1)).status === "published" && (await jobRow(e3, k2)).status === "scheduled", "daily cap holds the next post");
}

/* Version validation */
{
  const { env, a } = await setup();
  const bad = await call(env, "POST", "/versions", { cookie: a, body: { platform: "facebook", body: "x", linkUrl: "http://example.com" } });
  const noMedia = await call(env, "POST", "/versions", { cookie: a, body: { platform: "instagram", body: "x" } });
  ok(bad.status === 400 && noMedia.status === 400, "http links refused and Instagram needs an image");
}

/* Data deletion */
{
  const { env, a } = await setup();
  await connectMeta(env, a);
  const sign = async (payload, secret) => {
    const p = b64url(new TextEncoder().encode(JSON.stringify(payload)));
    const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    return b64url(new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(p)))) + "." + p;
  };
  const post = (signed) => handle(new Request("https://tahastudiolabs.com/api/vault/social/meta/data-deletion", {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: "signed_request=" + encodeURIComponent(signed)
  }), env);
  const good = await post(await sign({ user_id: "u-777" }, SECRET));
  const gd = await good.json();
  ok(good.status === 200 && gd.confirmation_code && gd.url.includes("deletion="), "valid deletion request returns code and url, no session needed");
  const left = await env.DB.prepare("SELECT COUNT(*) n FROM social_accounts WHERE status = 'active'").first();
  ok(left.n === 0, "deletion revokes every account for that Meta user");
  ok((await post(await sign({ user_id: "u-777" }, "wrong"))).status === 400, "bad signature is refused");
  ok((await post("garbage")).status === 400, "malformed request is refused");
}

/* Panel */
{
  const env = metaEnv();
  const r = await handle(new Request("https://tahastudiolabs.com/api/vault/social/panel"), env);
  const csp = r.headers.get("Content-Security-Policy") || "";
  ok(r.status === 200 && csp.includes("script-src 'self'") && !csp.includes("unsafe-inline"), "panel is served with a strict CSP");
  ok(!/innerHTML|eval\(|document\.write/.test(PANEL_JS), "panel script never injects HTML");
  const js = await handle(new Request("https://tahastudiolabs.com/api/vault/social/panel.js"), env);
  ok(js.status === 200 && (js.headers.get("Content-Type") || "").includes("javascript"), "panel script is served");
}

/* Mock still refused in production */
{
  const env = metaEnv({ ENVIRONMENT: "production", SOCIAL_CONNECTORS: "mock,meta" });
  ok(getConnector(env, "mock") === null || getConnector(env, "mock") === undefined, "mock stays refused in production");
}

globalThis.fetch = realFetch;
done();
