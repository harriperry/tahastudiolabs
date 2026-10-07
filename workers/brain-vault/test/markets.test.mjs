/* Markets step 1 (hub and spoke): every client belongs to a market, the market gives the
   currency, FCFA is written the Cameroon way, changing the market relabels the costs already
   entered (amounts kept), and one campaign can still use another currency.
   Same local setup as results.test.mjs (started by test/run-all.mjs). */
import fs from "node:fs";
import { CURRENCIES, MARKETS, currencyLabel, currencyOf, formatMoney, market } from "../../../assets/growth-markets.js";

const BASE = process.env.VAULT_URL || "http://127.0.0.1:8080/api/vault";
const ORIGIN = process.env.ORIGIN || "http://localhost:8080";
const run = Date.now().toString(36);
let pass = 0, fail = 0;
const ok = (c, n) => { if (c) { pass++; console.log("PASS " + n); } else { fail++; console.log("FAIL " + n); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function call(path, { method = "GET", body, raw, headers = {}, cookie, origin = ORIGIN } = {}) {
  const h = Object.assign({ Accept: "application/json" }, headers);
  if (body !== undefined) h["Content-Type"] = "application/json";
  if (cookie) h.Cookie = cookie;
  if (origin && method !== "GET") h.Origin = origin;
  let r;
  for (let i = 0; ; i++) {
    try {
      r = await fetch(BASE + path, { method, headers: h, body: raw !== undefined ? raw : body === undefined ? undefined : JSON.stringify(body), redirect: "manual" });
      break;
    } catch (e) {
      if (i >= 8) throw e;
      await sleep(1000);
    }
  }
  const text = await r.text();
  let data = null;
  try { data = JSON.parse(text); } catch (e) {}
  return { status: r.status, data, headers: r.headers };
}
const DEV_LOG = process.env.DEV_LOG;
const logSize = () => fs.statSync(DEV_LOG).size;
async function linkFor(email, after) {
  for (let i = 0; i < 40; i++) {
    const log = fs.readFileSync(DEV_LOG).subarray(after).toString("utf8");
    const m = [...log.matchAll(new RegExp("\\[dev mail\\] to=" + email.replace(/[.+]/g, "\\$&") + "[\\s\\S]*?#t=([A-Za-z0-9_-]+)", "g"))];
    if (m.length) return m.at(-1)[1];
    await sleep(150);
  }
  return null;
}
const cookieOf = (r) => (r.headers.getSetCookie().find((x) => x.startsWith("__Host-tv_session=")) || "").split(";")[0];
const PNG = Buffer.from("89504e470d0a1a0a0000000d4948445200000001000000010806000000" + "1f15c4890000000d49444154789c6360000002000154a24f5d0000000049454e44ae426082", "hex");

/* Invite, sign in, consent, submit the pilot intake, save the pilot brain. */
async function newClient(name, market) {
  const email = "mk-" + name.toLowerCase().replace(/[^a-z]+/g, "-") + "-" + run + "@example.com";
  const mark = logSize();
  const body = { name: name + " " + run, email, language: "en" };
  if (market) body.market = market;
  let r = await call("/admin/clients", { method: "POST", cookie: ADMIN, body });
  const client = r.data.client;
  r = await call("/auth/verify", { method: "POST", body: { t: await linkFor(email, mark) } });
  const cookie = cookieOf(r);
  await call("/consent", { method: "POST", cookie, body: { accepted: true, language: "en" } });
  r = await call("/uploads?section=pictures", { method: "POST", cookie, raw: PNG, headers: { "Content-Type": "image/png", "X-File-Name": "photo.png" } });
  const fixture = read("./fixtures/pilot-intake-v1.json");
  await call("/intake", { method: "PUT", cookie, body: { answerLanguage: "en", campaignLanguage: "en", profile: fixture.profile, uploads: { pictures: [{ fileId: r.data.file.id, name: "photo.png", mime: "image/png" }], founderStory: { text: "Story.", fileId: null }, previousPosts: [], faqs: { rows: [], fileId: null } } } });
  await call("/intake/submit", { method: "POST", cookie, body: {} });
  await withBrain(client.id);
  return client;
}
const read = (p) => JSON.parse(fs.readFileSync(new URL(p, import.meta.url)));
const ADMIN = "sf_sid=admin";

async function withBrain(id) {
  const brain = Object.assign(read("./fixtures/pilot-brain-v1.json"), { builtFromIntakeVersion: 1, editedByHarry: false });
  const r = await call("/admin/brain/" + id, { method: "POST", cookie: ADMIN, body: { brain } });
  if (r.status >= 300) console.log("brain save: " + r.status + " " + JSON.stringify(r.data).slice(0, 300));
}
async function addCampaign(id, month) {
  const r = await call("/admin/campaign/" + id, { method: "POST", cookie: ADMIN, body: { campaign: campaign(id, month) } });
  if (r.status >= 300) console.log("campaign save: " + r.status + " " + JSON.stringify(r.data).slice(0, 300));
}
function campaign(clientId, month) {
  const m = read("./fixtures/pilot-campaign-model.json");
  m.socialCopy = m.socialCopy.map((p) => (p.channel === "google_business" ? Object.assign(p, { hashtags: [] }) : p));
  return Object.assign({ schemaVersion: "campaign-1", clientId, campaignId: "cp_" + month.replace("-", "_") + "_en", brainVersion: 1, name: "Campaign " + month, month, goal: "sales", language: "en", channels: ["instagram", "facebook"], status: "in_production" }, m);
}

try {
  /* ---------- the shared module ---------- */
  ok(market("CM") === "CM" && market("XX") === "SE" && market(undefined) === "SE", "an unknown or missing market is Sweden");
  ok(currencyOf("CM") === "XAF" && currencyOf("SE") === "SEK" && currencyOf("NG") === "NGN", "Cameroon is FCFA (XAF), Sweden SEK, Nigeria NGN");
  ok(currencyLabel("XAF") === "FCFA" && formatMoney(25000, "XAF") === "25 000 FCFA" && formatMoney(1234567.6, "SEK") === "1 234 568 SEK", "money is whole, with spaces between thousands: 25 000 FCFA");
  ok(formatMoney(null, "XAF") === "-" && formatMoney(0, "XAF") === "0 FCFA", "no value shows a dash, zero shows 0");
  ok(Object.values(MARKETS).every((m) => CURRENCIES[m.currency] && m.timeZone), "every market has a known currency and a time zone");
  const src = ["../../../assets/growth-markets.js", "../src/admin.js", "../src/roi.js"].map((p) => fs.readFileSync(new URL(p, import.meta.url), "utf8")).join("\n") + fs.readFileSync(new URL("../../../assets/growth.js", import.meta.url), "utf8");
  ok(!src.includes("\u2014"), "no em-dash in the files Markets step 1 touched");
  const growthJs = fs.readFileSync(new URL("../../../assets/growth.js", import.meta.url), "utf8");
  ok(Object.keys(MARKETS).every((k) => growthJs.includes('code: "' + k + '"')), "the panel's first-load market list matches the shared one");

  /* ---------- clients and costs ---------- */
  let r = await call("/admin/clients", { cookie: ADMIN });
  ok(r.status === 200 && r.data.markets.some((m) => m.code === "CM" && m.currency === "XAF") && r.data.currencies.some((c) => c.code === "XAF" && c.label === "FCFA"), "the client list carries the markets and currencies for the panel");

  const SE = await newClient("Market Sweden");
  ok(SE.market === "SE", "a client invited without a market is in Sweden");
  const CM = await newClient("Market Cameroon", "CM");
  ok(CM.market === "CM", "a client can be invited straight into Cameroon");

  await addCampaign(CM.id, "2026-10");
  r = await call("/admin/costs/" + CM.id + "/cp_2026_10_en", { cookie: ADMIN });
  ok(r.status === 200 && r.data.currency === "XAF", "a Cameroon client's costs start in FCFA");
  r = await call("/admin/costs/" + CM.id + "/cp_2026_10_en", { method: "PUT", cookie: ADMIN, body: { fee: 50000, currency: "ZZZ" } });
  ok(r.data.currency === "XAF" && r.data.fee === 50000, "an unknown currency falls back to the market's");

  /* Switching a Swedish client (like the pilot) to Cameroon relabels her SEK costs. */
  await addCampaign(SE.id, "2026-10");
  await addCampaign(SE.id, "2026-11");
  r = await call("/admin/costs/" + SE.id + "/cp_2026_10_en", { method: "PUT", cookie: ADMIN, body: { fee: 1500 } });
  ok(r.data.currency === "SEK", "a Swedish client's costs are in SEK");
  await call("/admin/costs/" + SE.id + "/cp_2026_11_en", { method: "PUT", cookie: ADMIN, body: { fee: 20, currency: "EUR" } });
  r = await call("/admin/clients/" + SE.id + "/market", { method: "PUT", cookie: ADMIN, body: { market: "CM" } });
  ok(r.status === 200 && r.data.currency === "XAF", "Harry moves the client to Cameroon");
  r = await call("/admin/costs/" + SE.id + "/cp_2026_10_en", { cookie: ADMIN });
  ok(r.data.currency === "XAF" && r.data.fee === 1500, "her SEK costs now show in FCFA, the amount kept as entered");
  r = await call("/admin/costs/" + SE.id + "/cp_2026_11_en", { cookie: ADMIN });
  ok(r.data.currency === "EUR", "a campaign set to another currency on purpose keeps it");
  r = await call("/admin/clients", { cookie: ADMIN });
  ok(r.data.clients.find((c) => c.id === SE.id).market === "CM", "the list shows the new market");

  r = await call("/admin/clients/" + SE.id + "/market", { method: "PUT", cookie: ADMIN, body: { market: "XX" } });
  ok(r.status === 400, "an unknown market is refused");
  r = await call("/admin/clients/cl_doesnotexist1/market", { method: "PUT", cookie: ADMIN, body: { market: "CM" } });
  ok(r.status === 404, "an unknown client is refused");
  r = await call("/admin/clients/" + SE.id + "/market", { method: "PUT", body: { market: "SE" } });
  ok(r.status === 401, "only Harry can change a market");

  r = await call("/health");
  ok(r.data && ["m1", "l2"].includes(r.data.part), "health reports Markets step 1 or later");
} catch (e) {
  fail++;
  console.log("FAIL crashed: " + (e && e.stack || e));
}
console.log("\n" + pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
