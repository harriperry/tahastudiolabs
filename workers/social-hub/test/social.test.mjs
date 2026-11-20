/* Phase 1 suite for social-hub. Run: node --no-warnings test/social.test.mjs */
import { spawnSync } from "node:child_process";
import { SESSION_COOKIE as VAULT_COOKIE } from "../../brain-vault/src/config.js";
import { redact } from "../src/audit.js";
import { decryptToken, encryptToken } from "../src/crypto.js";
import { ensureSchema, resetSchemaCache } from "../src/db.js";
import { sent } from "../src/connectors/mock.js";
import { getConnector } from "../src/connectors/index.js";
import { processJob, sweepStuck, tick } from "../src/queue.js";
import { SESSION_COOKIE, nowMs, sha256hex } from "../src/util.js";
import { call, counter, makeEnv, makeSession, newKey, seedClient } from "./helpers.mjs";

const { ok, done } = counter();

async function setup() {
  const env = makeEnv();
  await seedClient(env, "cl_a", "a@example.com");
  await seedClient(env, "cl_b", "b@example.com");
  const a = await makeSession(env, { role: "client", clientId: "cl_a", email: "a@example.com" });
  const b = await makeSession(env, { role: "client", clientId: "cl_b", email: "b@example.com" });
  const admin = await makeSession(env, { role: "admin", email: "admin@example.com" });
  return { env, a, b, admin };
}

async function connect(env, cookie, ref = "page1") {
  await call(env, "POST", "/consent", { cookie });
  const s = await call(env, "POST", "/oauth/start", { cookie, body: { platform: "mock" } });
  const state = new URL(s.data.url).searchParams.get("state");
  const cb = await call(env, "GET", "/oauth/callback/mock?state=" + state + "&code=good-" + ref, { cookie });
  return { state, cb };
}

async function approvedVersion(env, cookie, text = "Hello world") {
  const v = await call(env, "POST", "/versions", { cookie, body: { platform: "mock", body: text } });
  await call(env, "POST", "/versions/approve", { cookie, body: { versionId: v.data.versionId } });
  return v.data.versionId;
}

async function enable(env, admin, clientId) {
  await call(env, "POST", "/admin/client", { cookie: admin, body: { clientId, enabled: true } });
}

/* 1. Migrations and Vault untouched */
{
  const { env } = await setup();
  const before = (await env.DB.prepare("SELECT COUNT(*) n FROM schema_migrations").first());
  await ensureSchema(env);
  resetSchemaCache();
  await ensureSchema(env);
  const sm = await env.DB.prepare("SELECT COUNT(*) n FROM social_migrations").first();
  ok(sm.n === MIG_COUNT(), "social migrations apply once and are idempotent");
  const tables = (await env.DB.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'social_%'").all()).results.map((r) => r.name);
  ok(["social_accounts", "social_audit", "social_consents", "social_global", "social_jobs", "social_oauth_states", "social_publications", "social_settings", "social_versions"].every((t) => tables.includes(t)), "all social tables exist");
  const after = (await env.DB.prepare("SELECT COUNT(*) n FROM schema_migrations").first());
  ok(before.n === after.n, "the Vault's own schema_migrations is never written");
  const g = spawnSync("git", ["diff", "--stat", "HEAD", "--", "../brain-vault"], { cwd: new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"), encoding: "utf8" });
  ok(g.status !== 0 || g.stdout.trim() === "", "workers/brain-vault has no changes against HEAD");
}
function MIG_COUNT() { return 2; }

/* 2. Session parity and auth */
{
  const { env, a, admin } = await setup();
  ok(SESSION_COOKIE === VAULT_COOKIE, "session cookie name matches the Vault");
  ok((await call(env, "GET", "/health")).status === 200, "health needs no login");
  ok((await call(env, "GET", "/status?clientId=cl_a")).status === 401, "no session is refused");
  ok((await call(env, "GET", "/status", { cookie: a })).status === 200, "a client session is accepted");
  const expired = await makeSession(env, { role: "client", clientId: "cl_a", email: "a@example.com", expiresAt: nowMs() - 1000 });
  ok((await call(env, "GET", "/status", { cookie: expired })).status === 401, "an expired session is refused");
  const gone = await makeSession(env, { role: "admin", email: "removed@example.com" });
  ok((await call(env, "GET", "/status?clientId=cl_a", { cookie: gone })).status === 401, "an admin removed from ADMIN_EMAILS is refused");
  ok((await call(env, "GET", "/status?clientId=cl_a", { cookie: admin })).status === 200, "admin may read a named client");
  ok((await call(env, "GET", "/status", { cookie: admin })).status === 400, "admin must name a client");
  ok((await call(env, "POST", "/consent", { cookie: a, origin: "https://evil.example" })).status === 403, "wrong Origin on a write is refused");
  ok((await call(env, "POST", "/admin/pause", { cookie: a, body: { paused: true } })).status === 403, "a client cannot use the kill switch");
}

/* 3. OAuth state */
{
  const { env, a, b } = await setup();
  const noConsent = await call(env, "POST", "/oauth/start", { cookie: a, body: { platform: "mock" } });
  ok(noConsent.status === 409, "connecting needs social consent first");
  await call(env, "POST", "/consent", { cookie: a });
  ok((await call(env, "POST", "/oauth/start", { cookie: a, body: { platform: "nope" } })).status === 400, "unknown platform is refused");
  const s1 = await call(env, "POST", "/oauth/start", { cookie: a, body: { platform: "mock" } });
  const state1 = new URL(s1.data.url).searchParams.get("state");
  const row = await env.DB.prepare("SELECT state_hash FROM social_oauth_states").first();
  ok(row.state_hash === (await sha256hex(state1)) && row.state_hash !== state1, "state is stored only as a hash");
  const good = await call(env, "GET", "/oauth/callback/mock?state=" + state1 + "&code=good-p1", { cookie: a });
  ok(good.status === 200 && good.data.accountId, "a valid callback connects the account");
  const replay = await call(env, "GET", "/oauth/callback/mock?state=" + state1 + "&code=good-p1", { cookie: a });
  ok(replay.status === 400, "a replayed state is refused");
  const s2 = await call(env, "POST", "/oauth/start", { cookie: a, body: { platform: "mock" } });
  const state2 = new URL(s2.data.url).searchParams.get("state");
  await env.DB.prepare("UPDATE social_oauth_states SET expires_at = ? WHERE state_hash = ?").bind(nowMs() - 1, await sha256hex(state2)).run();
  ok((await call(env, "GET", "/oauth/callback/mock?state=" + state2 + "&code=good-p2", { cookie: a })).status === 400, "an expired state is refused");
  const s3 = await call(env, "POST", "/oauth/start", { cookie: a, body: { platform: "mock" } });
  const state3 = new URL(s3.data.url).searchParams.get("state");
  await call(env, "POST", "/consent", { cookie: b });
  ok((await call(env, "GET", "/oauth/callback/mock?state=" + state3 + "&code=good-p3", { cookie: b })).status === 400, "a state started in another session cannot be completed");
  ok((await call(env, "GET", "/oauth/callback/mock?state=" + state3 + "&code=good-p3", { cookie: a })).status === 400, "and the state is burned after that attempt");
  const s4 = await call(env, "POST", "/oauth/start", { cookie: a, body: { platform: "mock" } });
  const state4 = new URL(s4.data.url).searchParams.get("state");
  ok((await call(env, "GET", "/oauth/callback/mock?state=" + state4 + "&code=bad", { cookie: a })).status === 400, "a rejected code connects nothing");
  const n = await env.DB.prepare("SELECT COUNT(*) n FROM social_accounts").first();
  ok(n.n === 1, "only the one valid account exists");
}

/* 4. Token encryption */
{
  const { env, a } = await setup();
  const k = newKey();
  const e1 = { SOCIAL_TOKEN_KEY: k }, e2 = { SOCIAL_TOKEN_KEY: k };
  const c1 = await encryptToken(e1, "secret-token"), c2 = await encryptToken(e2, "secret-token");
  ok(c1 !== c2 && !c1.includes("secret-token"), "ciphertext differs each time and hides the token");
  ok((await decryptToken(e1, c1)) === "secret-token", "token round trip works");
  let threw = false;
  try { await decryptToken({ SOCIAL_TOKEN_KEY: newKey() }, c1); } catch (e) { threw = true; }
  ok(threw, "a wrong key fails to decrypt");
  const rotated = { SOCIAL_TOKEN_KEY: newKey(), SOCIAL_TOKEN_KEY_ID: "k2", SOCIAL_TOKEN_KEY_PREV: k, SOCIAL_TOKEN_KEY_PREV_ID: "k1" };
  ok((await decryptToken(rotated, c1)) === "secret-token", "an older key id still decrypts after rotation");
  ok((await encryptToken(rotated, "x")).startsWith("k2."), "new values use the new key id");
  await connect(env, a);
  const acc = await env.DB.prepare("SELECT token_enc, refresh_enc FROM social_accounts").first();
  ok(!/mock-access|mock-refresh/.test(acc.token_enc + acc.refresh_enc), "stored tokens are ciphertext");
  const st = await call(env, "GET", "/status", { cookie: a });
  ok(!/token|mock-access/i.test(JSON.stringify(st.data)), "the status API never returns tokens");
  const logs = JSON.stringify((await env.DB.prepare("SELECT detail FROM social_audit").all()).results);
  ok(!/mock-access|mock-refresh|verifier/i.test(logs), "the audit log never holds a token");
  const r = redact({ accessToken: "x", nested: { password: "p", ok: "fine" }, list: [{ code: "c" }] });
  ok(r.accessToken === "[redacted]" && r.nested.password === "[redacted]" && r.nested.ok === "fine" && r.list[0].code === "[redacted]", "audit redaction covers nested secrets");
}

/* 5. Cross-client isolation */
{
  const { env, a, b, admin } = await setup();
  const { cb } = await connect(env, a);
  await call(env, "POST", "/consent", { cookie: b });
  const vA = await approvedVersion(env, a);
  const job = await call(env, "POST", "/jobs", { cookie: a, body: { accountId: cb.data.accountId, versionId: vA, runAt: nowMs() + 60000 } });
  ok(job.status === 200, "client A can schedule a job");
  const sb = await call(env, "GET", "/status?clientId=cl_a", { cookie: b });
  ok(sb.data.accounts.length === 0 && sb.data.jobs.length === 0, "client B sees none of A's accounts or jobs, even naming A");
  const crossJob = await call(env, "POST", "/jobs", { cookie: b, body: { clientId: "cl_a", accountId: cb.data.accountId, versionId: vA, runAt: nowMs() + 60000 } });
  ok(crossJob.status === 400, "B cannot schedule with A's account or version");
  ok((await call(env, "POST", "/versions/approve", { cookie: b, body: { clientId: "cl_a", versionId: vA } })).status === 404, "B cannot approve A's version");
  ok((await call(env, "POST", "/jobs/cancel", { cookie: b, body: { clientId: "cl_a", jobId: job.data.jobId } })).status === 404, "B cannot cancel A's job");
  ok((await call(env, "POST", "/accounts/revoke", { cookie: b, body: { clientId: "cl_a", accountId: cb.data.accountId } })).status === 404, "B cannot revoke A's account");
  const still = await env.DB.prepare("SELECT status FROM social_jobs WHERE id = ?").bind(job.data.jobId).first();
  ok(still.status === "scheduled", "A's job is untouched");
  ok((await call(env, "GET", "/status?clientId=cl_a", { cookie: admin })).data.jobs.length === 1, "admin can see A's jobs");
}

/* 6. Job rules */
{
  const { env, a } = await setup();
  const { cb } = await connect(env, a);
  const draft = await call(env, "POST", "/versions", { cookie: a, body: { platform: "mock", body: "draft only" } });
  ok((await call(env, "POST", "/jobs", { cookie: a, body: { accountId: cb.data.accountId, versionId: draft.data.versionId, runAt: nowMs() + 1000 } })).data.error === "version_not_approved", "an unapproved draft cannot be scheduled");
  const other = await call(env, "POST", "/versions", { cookie: a, body: { platform: "linkedin", body: "x" } });
  await call(env, "POST", "/versions/approve", { cookie: a, body: { versionId: other.data.versionId } });
  ok((await call(env, "POST", "/jobs", { cookie: a, body: { accountId: cb.data.accountId, versionId: other.data.versionId, runAt: nowMs() + 1000 } })).data.error === "platform_mismatch", "platform must match the account");
  ok((await call(env, "POST", "/jobs", { cookie: a, body: { accountId: "sa_nope", versionId: draft.data.versionId, runAt: nowMs() + 1000 } })).data.error === "account_unavailable", "unknown account is refused");
  ok((await call(env, "POST", "/versions", { cookie: a, body: { platform: "mock", body: "x".repeat(5001) } })).status === 400, "over-long post is refused");
}

/* 7. Publishing engine */
{
  const { env, a, admin } = await setup();
  const { cb } = await connect(env, a);
  const v = await approvedVersion(env, a, "Launch day");
  const sched = async (text) => {
    const vid = text ? await approvedVersion(env, a, text) : v;
    const j = await call(env, "POST", "/jobs", { cookie: a, body: { accountId: cb.data.accountId, versionId: vid, runAt: nowMs() + 1 } });
    return j.data.jobId;
  };
  const later = nowMs() + 5000;

  sent.length = 0;
  const j1 = await sched();
  ok((await processJob(env, j1, later)).startsWith("held:not_enabled"), "publishing is off until an admin enables the client");
  await enable(env, admin, "cl_a");
  await call(env, "POST", "/admin/pause", { cookie: admin, body: { paused: true } });
  ok((await processJob(env, j1, later)) === "held:global_pause", "the global pause stops sending");
  await call(env, "POST", "/admin/pause", { cookie: admin, body: { paused: false } });
  await call(env, "POST", "/admin/client", { cookie: admin, body: { clientId: "cl_a", paused: true } });
  ok((await processJob(env, j1, later)) === "held:client_pause", "a client pause stops sending");
  ok(sent.length === 0 && (await env.DB.prepare("SELECT status FROM social_jobs WHERE id = ?").bind(j1).first()).status === "scheduled", "held jobs stay scheduled and nothing was sent");
  await call(env, "POST", "/admin/client", { cookie: admin, body: { clientId: "cl_a", paused: false } });

  const results = await Promise.all([processJob(env, j1, later), processJob(env, j1, later)]);
  ok(sent.length === 1 && results.filter((r) => r === "published").length === 1, "two workers racing send exactly once");
  const pub = await env.DB.prepare("SELECT external_id FROM social_publications WHERE job_id = ?").bind(j1).first();
  ok(pub && (await env.DB.prepare("SELECT status FROM social_jobs WHERE id = ?").bind(j1).first()).status === "published", "published comes with a publication record");
  ok((await processJob(env, j1, later)) === "skipped" && sent.length === 1, "a published job is never sent again");

  const jf = await sched("Bad one [fail-permanent]");
  ok((await processJob(env, jf, later)) === "failed", "a permanent platform error ends as failed");
  const rowF = await env.DB.prepare("SELECT status, last_error FROM social_jobs WHERE id = ?").bind(jf).first();
  const pubF = await env.DB.prepare("SELECT 1 x FROM social_publications WHERE job_id = ?").bind(jf).first();
  ok(rowF.status === "failed" && !pubF && rowF.last_error, "a failure is never recorded as published");

  const jt = await sched("Flaky [fail-temp]");
  ok((await processJob(env, jt, later)) === "retry", "a safe temporary error is retried");
  let row = await env.DB.prepare("SELECT status, run_at, attempts FROM social_jobs WHERE id = ?").bind(jt).first();
  ok(row.status === "scheduled" && row.run_at > later && row.attempts === 1, "retry is rescheduled later with the attempt counted");
  await processJob(env, jt, row.run_at + 1);
  row = await env.DB.prepare("SELECT status, run_at, attempts FROM social_jobs WHERE id = ?").bind(jt).first();
  const last = await processJob(env, jt, row.run_at + 1);
  row = await env.DB.prepare("SELECT status FROM social_jobs WHERE id = ?").bind(jt).first();
  ok(last === "failed" && row.status === "failed", "retries stop at the attempt limit");

  /* crash safety: the Worker died after claiming. Never re-send. */
  const jc = await sched("Crash case");
  await env.DB.prepare("UPDATE social_jobs SET status = 'publishing', attempts = 1, claimed_at = ? WHERE id = ?").bind(nowMs() - 3600000, jc).run();
  const before = sent.length;
  await tick(env, later);
  const rc = await env.DB.prepare("SELECT status FROM social_jobs WHERE id = ?").bind(jc).first();
  ok(rc.status === "needs_check" && sent.length === before, "a job stuck mid-send is flagged for a human and never resent");
  ok((await sweepStuck(env, later)) === 0, "sweeping again changes nothing");

  const jx = await sched("Cancel me");
  ok((await call(env, "POST", "/jobs/cancel", { cookie: a, body: { jobId: jx } })).status === 200, "a scheduled job can be cancelled");
  ok((await processJob(env, jx, later)) === "skipped", "a cancelled job is not sent");

  const jr = await sched("Revoked soon");
  await call(env, "POST", "/accounts/revoke", { cookie: a, body: { accountId: cb.data.accountId } });
  ok((await processJob(env, jr, later)) === "failed", "a revoked account cannot publish");
  const tok = await env.DB.prepare("SELECT token_enc, refresh_enc FROM social_accounts").first();
  ok(tok.token_enc === "revoked" && tok.refresh_enc === null, "revoking wipes the stored tokens");
}

/* 8. Mock is refused in production */
{
  ok(getConnector({ SOCIAL_CONNECTORS: "mock", ENVIRONMENT: "production" }, "mock") === null, "mock connector is off in production");
  ok(getConnector({ SOCIAL_CONNECTORS: "mock", ENVIRONMENT: "production", SOCIAL_ALLOW_MOCK: "on" }, "mock") !== null, "mock only runs in production with an explicit switch");
  ok(getConnector({ SOCIAL_CONNECTORS: "", ENVIRONMENT: "development" }, "mock") === null, "no connector runs unless listed");
}

done();
