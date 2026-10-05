/* Phase 6 test: export, leaving, the 6 month retention rule and erasure leave no trace.
   Run the Worker behind the local site on port 8080 (like panel.test.mjs) and with
   --test-scheduled and --persist-to .wrangler/state, then:
     DEV_LOG=dev.log WRANGLER=./node_modules/.bin/wrangler node test/gdpr.test.mjs */
import fs from "node:fs";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";

const BASE = process.env.VAULT_URL || "http://127.0.0.1:8080/api/vault";
const WORKER = process.env.WORKER_URL || "http://127.0.0.1:8787";
const ORIGIN = process.env.ORIGIN || "http://localhost:8080";
const DEV_LOG = process.env.DEV_LOG;
const run = Date.now().toString(36);
let pass = 0, fail = 0;
const ok = (c, n) => { if (c) { pass++; console.log("PASS " + n); } else { fail++; console.log("FAIL " + n); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const nextIp = () => "10.70." + crypto.randomInt(1, 250) + "." + crypto.randomInt(1, 250);
async function call(path, { method = "GET", body, raw, headers = {}, cookie, origin = ORIGIN } = {}) {
  const h = { Accept: "application/json", ...headers };
  if (body !== undefined) h["Content-Type"] = "application/json";
  if (cookie) h.Cookie = cookie;
  if (origin && method !== "GET") h.Origin = origin;
  const init = { method, headers: h, body: raw !== undefined ? raw : body === undefined ? undefined : JSON.stringify(body), redirect: "manual" };
  let r;
  try {
    r = await fetch(BASE + path, init);
  } catch (e) {
    /* Local only: wrangler dev can restart for a moment after the test edits its database
       directly with "wrangler d1 execute". Wait and try once more. */
    await sleep(2000);
    r = await fetch(BASE + path, init);
  }
  const text = await r.text();
  let data = null;
  try { data = JSON.parse(text); } catch (e) {}
  return { status: r.status, data, text, headers: r.headers };
}
const logSize = () => fs.statSync(DEV_LOG).size;
async function linkFor(email, after, tries = 40) {
  for (let i = 0; i < tries; i++) {
    const log = fs.readFileSync(DEV_LOG).subarray(after).toString("utf8");
    const m = [...log.matchAll(new RegExp("\\[dev mail\\] to=" + email.replace(/[.+]/g, "\\$&") + "[\\s\\S]*?#t=([A-Za-z0-9_-]+)", "g"))];
    if (m.length) return m.at(-1)[1];
    await sleep(150);
  }
  return null;
}
const cookieOf = (r) => ((r.headers.getSetCookie() || []).find((x) => x.startsWith("__Host-tv_session=")) || "").split(";")[0] || null;
function sql(command) {
  const out = execFileSync(process.env.WRANGLER || "wrangler", ["d1", "execute", "brain-vault-db", "--local", "--persist-to", process.env.PERSIST || ".wrangler/state", "--json", "--command", command], { encoding: "utf8", cwd: process.env.WORKER_DIR || process.cwd() });
  return JSON.parse(out)[0].results;
}
const read = (p) => JSON.parse(fs.readFileSync(new URL(p, import.meta.url)));
const ADMIN = "sf_sid=admin";
const PNG = Buffer.from("89504e470d0a1a0a0000000d4948445200000001000000010806000000" + "1f15c4890000000d49444154789c6360000002000154a24f5d0000000049454e44ae426082", "hex");

/* A client with a full history: consent, picture, intake, brain, campaign, sessions, links. */
async function fullClient(tag) {
  const email = tag + "-" + run + "@example.com";
  let mark = logSize();
  let r = await call("/admin/clients", { method: "POST", cookie: ADMIN, body: { name: "GDPR " + tag, email, language: "sv" } });
  const id = r.data.client.id;
  r = await call("/auth/verify", { method: "POST", body: { t: await linkFor(email, mark) } });
  const cookie = cookieOf(r);
  await call("/consent", { method: "POST", cookie, body: { accepted: true, language: "sv" } });
  r = await call("/uploads?section=pictures", { method: "POST", cookie, raw: PNG, headers: { "Content-Type": "image/png", "X-File-Name": "dish.png" } });
  const fileId = r.data.file.id;
  const fx = read("./fixtures/pilot-intake-v1.json");
  await call("/intake", { method: "PUT", cookie, body: { answerLanguage: "sv", campaignLanguage: "sv", profile: fx.profile, uploads: { pictures: [{ fileId, name: "dish.png", mime: "image/png" }], founderStory: { text: "Story.", fileId: null }, previousPosts: [], faqs: { rows: [], fileId: null } } } });
  await call("/intake/submit", { method: "POST", cookie, body: {} });
  await call("/admin/brain/" + id, { method: "POST", cookie: ADMIN, body: { brain: Object.assign(read("./fixtures/pilot-brain-v1.json"), { builtFromIntakeVersion: 1, editedByHarry: false }) } });
  const camp = read("./fixtures/pilot-campaign-model.json");
  camp.socialCopy = camp.socialCopy.map((p) => (p.channel === "google_business" ? Object.assign(p, { hashtags: [] }) : p));
  await call("/admin/campaign/" + id, { method: "POST", cookie: ADMIN, body: { campaign: Object.assign({ schemaVersion: "campaign-1", clientId: id, campaignId: "cp_2026_10_sv", brainVersion: 1, name: "Okt", month: "2026-10", goal: "sales", language: "sv", channels: ["instagram", "facebook", "google_business"], status: "in_production" }, camp) } });
  mark = logSize();
  await call("/auth/request-link", { method: "POST", body: { email }, headers: { "CF-Connecting-IP": nextIp() } });
  await linkFor(email, mark);
  return { id, email, cookie, fileId };
}

/* Every row anywhere in the database that mentions the client id or the email. */
function scan(id, email) {
  const tables = sql("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%'").map((t) => t.name);
  const hits = [];
  for (const t of tables) {
    const cols = sql("PRAGMA table_info(" + t + ")").map((c) => c.name);
    const cond = cols.map((c) => "(CAST(" + c + " AS TEXT) LIKE '%" + id + "%' OR LOWER(CAST(" + c + " AS TEXT)) LIKE '%" + email.toLowerCase() + "%')").join(" OR ");
    const n = sql("SELECT COUNT(*) AS n FROM " + t + " WHERE " + cond)[0].n;
    if (n) hits.push(t + ":" + n);
  }
  return { tables, hits };
}

try {
  /* Export */
  const A = await fullClient("a");
  let r = await call("/admin/export/" + A.id, { cookie: ADMIN });
  const x = r.data;
  ok(r.status === 200 && /attachment/.test(r.headers.get("content-disposition") || ""), "export downloads as a file");
  ok(x.client.email === A.email && x.intakes.length === 1 && x.files.length === 1 && x.brains.length === 1 && x.campaigns.length === 1, "export has profile, intake, file list, brain and campaign");
  ok(x.consentLog.length === 1 && x.statusHistory.length >= 4 && x.intakeDraft, "export has the consent log, status history and draft");
  ok(!/sk-ant|apiKey/i.test(r.text), "export holds no API key");
  r = await call("/admin/export/" + A.id, { cookie: A.cookie });
  ok(r.status === 403, "a client cannot use the admin export");
  r = await call("/admin/export/" + A.id);
  ok(r.status === 401, "a visitor cannot export");

  /* Leaving */
  r = await call("/admin/clients/" + A.id + "/left", { method: "POST", cookie: ADMIN, body: { left: true } });
  const months = (new Date(r.data.eraseAfter) - new Date(r.data.leftAt)) / (30.4 * 86400000);
  ok(r.status === 200 && r.data.leftAt && months > 5.8 && months < 6.2, "Mark as left: erase date is 6 months later");
  r = await call("/portal/state", { cookie: A.cookie });
  ok(r.status === 401, "a client who left is signed out at once");
  let mark = logSize();
  r = await call("/auth/request-link", { method: "POST", body: { email: A.email }, headers: { "CF-Connecting-IP": nextIp() } });
  ok(r.status === 200 && !(await linkFor(A.email, mark, 12)), "a client who left gets the neutral reply and no login link");
  r = await call("/admin/clients", { cookie: ADMIN });
  ok(r.data.clients.find((c) => c.id === A.id).eraseAfter, "client list shows the erase date");
  r = await call("/admin/clients/" + A.id + "/left", { method: "POST", cookie: ADMIN, body: { left: false } });
  ok(r.status === 200 && r.data.leftAt === null, "Undo: the client is back");
  mark = logSize();
  await call("/auth/request-link", { method: "POST", body: { email: A.email }, headers: { "CF-Connecting-IP": nextIp() } });
  ok(!!(await linkFor(A.email, mark)), "a returning client can sign in again");

  /* Erase now */
  r = await call("/admin/clients/" + A.id, { method: "DELETE", cookie: ADMIN, body: { confirm: "wrong@example.com" } });
  ok(r.status === 400 && r.data.error === "confirm", "erasure needs the client's email typed exactly");
  r = await call("/admin/clients/" + A.id, { method: "DELETE", cookie: A.cookie, body: { confirm: A.email } });
  ok(r.status === 401 || r.status === 403, "a client cannot erase");
  r = await call("/admin/clients/" + A.id, { method: "DELETE", cookie: ADMIN, body: { confirm: A.email.toUpperCase() }, origin: "https://evil.example" });
  ok(r.status === 403, "erasure from another site is refused");
  const before = scan(A.id, A.email);
  ok(before.hits.length >= 6, "before erasure the client is in " + before.hits.length + " tables");
  r = await call("/admin/clients/" + A.id, { method: "DELETE", cookie: ADMIN, body: { confirm: A.email.toUpperCase() } });
  ok(r.status === 200 && r.data.erased && r.data.filesDeleted === 1 && r.data.rowsDeleted > 10, "Erase now: 1 file and " + (r.data && r.data.rowsDeleted) + " records deleted");
  ok(r.data.remaining.rows === 0 && r.data.remaining.files === 0, "the Vault's own check finds no trace");
  const after = scan(A.id, A.email);
  ok(after.hits.length === 0, "full scan of all " + after.tables.length + " tables finds nothing" + (after.hits.length ? ": " + after.hits.join(", ") : ""));
  const bucket = "e:" + crypto.createHash("sha256").update("email:" + A.email).digest("hex");
  ok(sql("SELECT COUNT(*) AS n FROM rate_events WHERE bucket = '" + bucket + "'")[0].n === 0, "rate-limit entries for the email are gone");
  r = await call("/files/" + A.fileId, { cookie: ADMIN });
  ok(r.status === 404, "the uploaded file is gone from storage");
  r = await call("/admin/intake/" + A.id, { cookie: ADMIN });
  ok(r.status === 404, "the client no longer exists");
  const logRow = sql("SELECT * FROM erasure_log ORDER BY id DESC LIMIT 1")[0];
  const idHash = crypto.createHash("sha256").update("client:" + A.id).digest("hex");
  ok(logRow.client_id_hash === idHash && logRow.reason === "admin" && Object.keys(logRow).sort().join(",") === "client_id_hash,erased_at,id,reason", "only an anonymous erasure log line stays");
  mark = logSize();
  r = await call("/auth/request-link", { method: "POST", body: { email: A.email }, headers: { "CF-Connecting-IP": nextIp() } });
  ok(r.status === 200 && !(await linkFor(A.email, mark, 12)), "an erased email gets the neutral reply and no link");
  r = await call("/portal/state", { cookie: A.cookie });
  ok(r.status === 401, "the erased client's old session no longer works");

  /* The 6 month retention rule */
  const B = await fullClient("b");
  const C = await fullClient("c");
  await call("/admin/clients/" + B.id + "/left", { method: "POST", cookie: ADMIN, body: { left: true } });
  await call("/admin/clients/" + C.id + "/left", { method: "POST", cookie: ADMIN, body: { left: true } });
  const old = new Date();
  old.setUTCMonth(old.getUTCMonth() - 7);
  sql("UPDATE clients SET left_at = '" + old.toISOString() + "' WHERE id = '" + B.id + "'");
  const s = await fetch(WORKER + "/__scheduled?cron=17+3+*+*+*");
  ok(s.status === 200, "the daily job runs");
  await sleep(2500);
  ok(scan(B.id, B.email).hits.length === 0, "a client who left 7 months ago is erased by the daily job");
  ok(sql("SELECT reason FROM erasure_log ORDER BY id DESC LIMIT 1")[0].reason === "retention", "the log line says the retention rule erased it");
  r = await call("/admin/intake/" + C.id, { cookie: ADMIN });
  ok(r.status === 200, "a client who left today is kept until the 6 months have passed");
  await call("/admin/clients/" + C.id, { method: "DELETE", cookie: ADMIN, body: { confirm: C.email } });

  r = await call("/health");
  ok(r.data.phase === 6, "health reports phase 6");
} catch (e) {
  fail++;
  console.log("FAIL crashed: " + e.stack);
}
console.log("\n" + pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
