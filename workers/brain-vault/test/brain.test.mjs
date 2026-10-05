/* Phase 4 test: Business Brain versions in the Brain Vault.
   Same local setup as panel.test.mjs (Vault behind the local site on port 8080, which fakes
   ScriptForge's /api/me: cookie sf_sid=admin is the admin).
     DEV_LOG=/path/to/dev.log node test/brain.test.mjs */
import fs from "node:fs";

const BASE = process.env.VAULT_URL || "http://127.0.0.1:8080/api/vault";
const ORIGIN = process.env.ORIGIN || "http://localhost:8080";
const DEV_LOG = process.env.DEV_LOG;
const run = Date.now().toString(36);
let pass = 0, fail = 0;
const ok = (c, n) => { if (c) { pass++; console.log("PASS " + n); } else { fail++; console.log("FAIL " + n); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function call(path, { method = "GET", body, cookie, origin = ORIGIN } = {}) {
  const h = { Accept: "application/json" };
  if (body !== undefined) h["Content-Type"] = "application/json";
  if (cookie) h.Cookie = cookie;
  if (origin && method !== "GET") h.Origin = origin;
  const r = await fetch(BASE + path, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body), redirect: "manual" });
  const text = await r.text();
  let data = null;
  try { data = JSON.parse(text); } catch (e) {}
  return { status: r.status, data, headers: r.headers };
}
async function linkFor(email, after) {
  for (let i = 0; i < 40; i++) {
    const log = fs.readFileSync(DEV_LOG).subarray(after).toString("utf8");
    const m = [...log.matchAll(new RegExp("\\[dev mail\\] to=" + email.replace(/[.+]/g, "\\$&") + "[\\s\\S]*?#t=([A-Za-z0-9_-]+)", "g"))];
    if (m.length) return m.at(-1)[1];
    await sleep(150);
  }
  return null;
}
const ADMIN = "sf_sid=admin";
const brainBody = (from, extra = {}) => ({ brain: Object.assign(JSON.parse(fs.readFileSync(new URL("./fixtures/pilot-brain-v1.json", import.meta.url))), { builtFromIntakeVersion: from, editedByHarry: false }, extra) });
const fixture = JSON.parse(fs.readFileSync(new URL("./fixtures/pilot-intake-v1.json", import.meta.url)));

try {
  const email = "brain-" + run + "@example.com";
  let mark = fs.statSync(DEV_LOG).size;
  let r = await call("/admin/clients", { method: "POST", cookie: ADMIN, body: { name: "Brain Test Kitchen", email, language: "en" } });
  const id = r.data.client.id;
  const t = await linkFor(email, mark);
  r = await call("/auth/verify", { method: "POST", body: { t } });
  const client = (r.headers.getSetCookie().find((x) => x.startsWith("__Host-tv_session=")) || "").split(";")[0];
  await call("/consent", { method: "POST", cookie: client, body: { accepted: true, language: "en" } });

  r = await call("/admin/brain/" + id, { cookie: ADMIN });
  ok(r.status === 200 && r.data.latest === null && r.data.versions.length === 0, "no brain yet: empty version list");
  r = await call("/admin/brain/" + id, { method: "POST", cookie: ADMIN, body: brainBody(1) });
  ok(r.status === 400 && r.data.error === "intake", "a brain for an intake that was never submitted is refused");

  const answers = { answerLanguage: "en", campaignLanguage: "en", profile: fixture.profile, uploads: { pictures: [], founderStory: { text: "Story.", fileId: null }, previousPosts: [], faqs: { rows: [], fileId: null } } };
  await call("/intake", { method: "PUT", cookie: client, body: answers });
  r = await call("/intake/submit", { method: "POST", cookie: client, body: {} });
  ok(r.status === 200 && r.data.intakeVersion === 1, "client submits intake v1");

  r = await call("/admin/brain/" + id, { method: "POST", cookie: client, body: brainBody(1) });
  ok(r.status === 403, "a client cannot save a brain");
  r = await call("/admin/brain/" + id, { method: "POST", cookie: "sf_sid=user", body: brainBody(1) });
  ok(r.status === 401, "a public ScriptForge user cannot save a brain");
  r = await call("/admin/brain/" + id, { method: "POST", cookie: ADMIN, body: brainBody(1), origin: "https://evil.example" });
  ok(r.status === 403, "a brain posted from another site is refused");

  const bad = brainBody(1);
  delete bad.brain.personas;
  r = await call("/admin/brain/" + id, { method: "POST", cookie: ADMIN, body: bad });
  ok(r.status === 400 && r.data.error === "invalid" && r.data.details.some((x) => /personas/.test(x)), "a brain that breaks the schema is refused with details");
  const extra = brainBody(1, { secretNotes: "x" });
  r = await call("/admin/brain/" + id, { method: "POST", cookie: ADMIN, body: extra });
  ok(r.status === 400, "unknown fields are refused");
  const keyed = brainBody(1);
  keyed.brain.voice.summary = "use sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789 for calls";
  r = await call("/admin/brain/" + id, { method: "POST", cookie: ADMIN, body: keyed });
  ok(r.status === 400 && r.data.error === "api_key", "anything that looks like an API key is refused, never stored");

  const dashed = brainBody(1, { brainVersion: 99, clientId: "cl_someoneelse", createdAt: "2000-01-01T00:00:00Z" });
  dashed.brain.positioning.oneLiner = "Hot food — cooked fresh";
  r = await call("/admin/brain/" + id, { method: "POST", cookie: ADMIN, body: dashed });
  ok(r.status === 201 && r.data.brainVersion === 1, "valid brain saved as v1");
  ok(r.data.brain.clientId === id && r.data.brain.brainVersion === 1 && r.data.brain.createdAt !== "2000-01-01T00:00:00Z", "the Vault sets client id, version and time itself");
  ok(!/—/.test(JSON.stringify(r.data.brain)) && r.data.brain.positioning.oneLiner === "Hot food, cooked fresh", "em-dashes are replaced on save");
  ok(r.data.status === "brain_ready" && r.data.statusLabel.en === "Your strategy is ready", "status becomes Brain ready");

  r = await call("/status", { cookie: client });
  ok(r.data.status === "brain_ready" && r.data.statusLabel.sv === "Din strategi är klar", "the portal shows Din strategi är klar / Your strategy is ready");
  ok(r.data.history.some((x) => x.status === "brain_ready"), "status history records the change");

  r = await call("/admin/clients", { cookie: ADMIN });
  let c = r.data.clients.find((x) => x.id === id);
  ok(c.latestBrainVersion === 1 && c.brainBuiltFromIntakeVersion === 1 && c.hasNewIntake === false, "client list shows brain v1, up to date");

  r = await call("/admin/brain/" + id, { method: "POST", cookie: ADMIN, body: brainBody(1, { editedByHarry: true }) });
  ok(r.status === 201 && r.data.brainVersion === 2, "saving again creates v2");
  r = await call("/admin/brain/" + id, { cookie: ADMIN });
  ok(r.data.versions.length === 2 && r.data.versions[0].version === 2 && r.data.versions[0].editedByHarry === true && r.data.latest.brainVersion === 2, "version list newest first, latest is v2");
  r = await call("/admin/brain/" + id + "/1", { cookie: ADMIN });
  ok(r.status === 200 && r.data.brain.brainVersion === 1, "older version v1 stays readable");
  r = await call("/admin/brain/" + id + "/9", { cookie: ADMIN });
  ok(r.status === 404, "unknown version is 404");
  r = await call("/admin/brain/" + id + "/1", { cookie: client });
  ok(r.status === 403, "a client cannot read the brain");

  await call("/intake/submit", { method: "POST", cookie: client, body: {} });
  r = await call("/admin/clients", { cookie: ADMIN });
  c = r.data.clients.find((x) => x.id === id);
  ok(c.latestIntakeVersion === 2 && c.hasNewIntake === true, "a newer intake makes Regenerate from latest intake available");
  ok(c.status === "submitted", "resubmitting moves the status back to Submitted");
  r = await call("/admin/brain/" + id, { method: "POST", cookie: ADMIN, body: brainBody(2) });
  ok(r.status === 201 && r.data.brainVersion === 3 && r.data.brain.builtFromIntakeVersion === 2 && r.data.status === "brain_ready", "brain v3 from intake v2, status Brain ready again");

  r = await call("/health");
  ok(r.data.phase === 4, "health reports phase 4");
} catch (e) {
  fail++;
  console.log("FAIL crashed: " + e.stack);
}
console.log("\n" + pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
