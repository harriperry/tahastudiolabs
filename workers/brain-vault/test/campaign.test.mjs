/* Phase 5 test: campaigns and manual status in the Brain Vault.
   Same local setup as brain.test.mjs (Vault behind the local site on port 8080).
     DEV_LOG=/path/to/dev.log node test/campaign.test.mjs */
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
const read = (p) => JSON.parse(fs.readFileSync(new URL(p, import.meta.url)));
const ADMIN = "sf_sid=admin";
const fixture = read("./fixtures/pilot-intake-v1.json");
function campaign(id, extra = {}) {
  const m = read("./fixtures/pilot-campaign-model.json");
  m.socialCopy = m.socialCopy.map((p) => (p.channel === "google_business" ? Object.assign(p, { hashtags: [] }) : p));
  return Object.assign({ schemaVersion: "campaign-1", clientId: id, campaignId: "cp_2026_10_en", brainVersion: 1, name: "October campaign for Test Kitchen", month: "2026-10", goal: "sales", language: "en", channels: ["instagram", "facebook", "google_business"], status: "in_production" }, m, extra);
}

try {
  const email = "camp-" + run + "@example.com";
  const mark = fs.statSync(DEV_LOG).size;
  let r = await call("/admin/clients", { method: "POST", cookie: ADMIN, body: { name: "Campaign Test Kitchen", email, language: "en" } });
  const id = r.data.client.id;
  r = await call("/auth/verify", { method: "POST", body: { t: await linkFor(email, mark) } });
  const client = (r.headers.getSetCookie().find((x) => x.startsWith("__Host-tv_session=")) || "").split(";")[0];
  await call("/consent", { method: "POST", cookie: client, body: { accepted: true, language: "en" } });
  await call("/intake", { method: "PUT", cookie: client, body: { answerLanguage: "en", campaignLanguage: "en", profile: fixture.profile, uploads: { pictures: [], founderStory: { text: "Story.", fileId: null }, previousPosts: [], faqs: { rows: [], fileId: null } } } });
  await call("/intake/submit", { method: "POST", cookie: client, body: {} });

  r = await call("/admin/campaign/" + id, { method: "POST", cookie: ADMIN, body: { campaign: campaign(id) } });
  ok(r.status === 400 && r.data.error === "brain", "a campaign needs a saved brain version");
  const brain = Object.assign(read("./fixtures/pilot-brain-v1.json"), { builtFromIntakeVersion: 1, editedByHarry: false });
  r = await call("/admin/brain/" + id, { method: "POST", cookie: ADMIN, body: { brain } });
  ok(r.status === 201, "brain v1 saved");

  r = await call("/admin/campaigns/" + id, { cookie: ADMIN });
  ok(r.status === 200 && r.data.campaigns.length === 0, "no campaigns yet");
  r = await call("/admin/campaign/" + id, { method: "POST", cookie: client, body: { campaign: campaign(id) } });
  ok(r.status === 403, "a client cannot save a campaign");
  r = await call("/admin/campaign/" + id, { method: "POST", cookie: ADMIN, body: { campaign: campaign(id) }, origin: "https://evil.example" });
  ok(r.status === 403, "a campaign posted from another site is refused");
  const short = campaign(id);
  short.hook = short.hook.slice(0, 3);
  r = await call("/admin/campaign/" + id, { method: "POST", cookie: ADMIN, body: { campaign: short } });
  ok(r.status === 400 && r.data.error === "invalid" && r.data.details.some((x) => /hook/.test(x)), "a campaign with 3 hooks instead of 5 is refused");
  const keyed = campaign(id);
  keyed.email.body = "AIzaSyA1234567890abcdefghijklmnopqrstuv";
  r = await call("/admin/campaign/" + id, { method: "POST", cookie: ADMIN, body: { campaign: keyed } });
  ok(r.status === 400 && r.data.error === "api_key", "anything that looks like an API key is refused");

  const dashed = campaign(id, { clientId: "cl_someoneelse", status: "delivered" });
  dashed.concept.title = "A Little Extra \u2014 October";
  r = await call("/admin/campaign/" + id, { method: "POST", cookie: ADMIN, body: { campaign: dashed } });
  ok(r.status === 201 && r.data.created === true, "English October campaign saved");
  ok(r.data.campaign.clientId === id && r.data.campaign.status === "in_production", "the Vault sets the client id and puts the campaign in production");
  ok(r.data.campaign.concept.title === "A Little Extra, October", "em-dashes are replaced on save");
  ok(r.data.clientStatus === "campaign_in_production" && r.data.statusLabel.sv === "Kampanjen produceras", "status becomes Campaign in production");
  r = await call("/status", { cookie: client });
  ok(r.data.status === "campaign_in_production", "the portal shows Campaign in production");

  r = await call("/admin/campaign/" + id, { method: "POST", cookie: ADMIN, body: { campaign: campaign(id, { campaignId: "cp_2026_10_sv", language: "sv", name: "Oktoberkampanj" }) } });
  ok(r.status === 201, "Swedish October campaign saved next to it");
  const edited = campaign(id);
  edited.hook[0] = "Edited hook";
  r = await call("/admin/campaign/" + id, { method: "POST", cookie: ADMIN, body: { campaign: edited } });
  ok(r.status === 200 && r.data.created === false && r.data.campaign.hook[0] === "Edited hook", "saving the same campaign again updates it");
  r = await call("/admin/campaigns/" + id, { cookie: ADMIN });
  ok(r.data.campaigns.length === 2 && r.data.campaigns.every((x) => x.status === "in_production") && r.data.campaigns.some((x) => x.language === "sv"), "list shows both campaigns");
  r = await call("/admin/campaign/" + id + "/cp_2026_10_en", { cookie: ADMIN });
  ok(r.status === 200 && r.data.campaign.hook[0] === "Edited hook", "one campaign can be opened");
  r = await call("/admin/campaign/" + id + "/cp_nothere", { cookie: ADMIN });
  ok(r.status === 404, "unknown campaign is 404");

  r = await call("/admin/campaign/" + id + "/cp_2026_10_en/status", { method: "PATCH", cookie: ADMIN, body: { status: "delivered" } });
  ok(r.status === 200 && r.data.clientStatus === "campaign_delivered" && r.data.campaign.status === "delivered", "Mark delivered works");
  r = await call("/status", { cookie: client });
  ok(r.data.status === "campaign_delivered" && r.data.statusLabel.en === "Campaign delivered", "the portal shows Campaign delivered");
  ok(["submitted", "brain_ready", "campaign_in_production", "campaign_delivered"].every((s) => r.data.history.some((x) => x.status === s)), "status history has every step");
  r = await call("/admin/campaign/" + id + "/cp_2026_10_en/status", { method: "PATCH", cookie: ADMIN, body: { status: "lost" } });
  ok(r.status === 400, "an unknown campaign status is refused");
  r = await call("/admin/campaign/" + id + "/cp_2026_10_en/status", { method: "PATCH", cookie: client, body: { status: "delivered" } });
  ok(r.status === 403, "a client cannot change a campaign status");

  r = await call("/admin/status/" + id, { method: "PATCH", cookie: ADMIN, body: { status: "brain_ready" } });
  ok(r.status === 200 && r.data.clientStatus === "brain_ready", "manual status change works");
  r = await call("/status", { cookie: client });
  ok(r.data.status === "brain_ready", "the portal follows the manual change");
  r = await call("/admin/status/" + id, { method: "PATCH", cookie: ADMIN, body: { status: "paid" } });
  ok(r.status === 400, "an unknown client status is refused");
  r = await call("/admin/status/" + id, { method: "PATCH", cookie: client, body: { status: "campaign_delivered" } });
  ok(r.status === 403, "a client cannot change its own status");

  r = await call("/health");
  ok(r.data.phase === 5, "health reports phase 5");
} catch (e) {
  fail++;
  console.log("FAIL crashed: " + e.stack);
}
console.log("\n" + pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
