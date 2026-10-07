/* V2 Part D test: results tracking. The questions per business type, the business type on the
   plan, the portal's "How did it go?" (when it asks, checks, skip, edit, one notice to Harry
   with no numbers), Harry's corrections kept apart from the client's answers, the numbers and
   note in {{LAST_RESULTS}}, one client never seeing another's results, export and erasure.
   Same local setup as review.test.mjs (started by test/run-all.mjs). */
import fs from "node:fs";
import { execFileSync } from "node:child_process";
import { cleanResults, effective, fieldsFor, mainField, reportedText } from "../../../assets/growth-resultfields.js";

const BASE = process.env.VAULT_URL || "http://127.0.0.1:8080/api/vault";
const ORIGIN = process.env.ORIGIN || "http://localhost:8080";
const SITE = ORIGIN.replace("localhost", "127.0.0.1");
const DEV_LOG = process.env.DEV_LOG;
const run = Date.now().toString(36);
let pass = 0, fail = 0;
const ok = (c, n) => { if (c) { pass++; console.log("PASS " + n); } else { fail++; console.log("FAIL " + n); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function call(path, { method = "GET", body, raw, headers = {}, cookie, origin = ORIGIN, abs } = {}) {
  const h = Object.assign({ Accept: "application/json" }, headers);
  if (body !== undefined) h["Content-Type"] = "application/json";
  if (cookie) h.Cookie = cookie;
  if (origin && method !== "GET") h.Origin = origin;
  const r = await fetch(abs || BASE + path, { method, headers: h, body: raw !== undefined ? raw : body === undefined ? undefined : JSON.stringify(body), redirect: "manual" });
  const text = await r.text();
  let data = null;
  try { data = JSON.parse(text); } catch (e) {}
  return { status: r.status, data, text, headers: r.headers };
}
const logSize = () => fs.statSync(DEV_LOG).size;
async function mailAfter(re, after) {
  for (let i = 0; i < 40; i++) {
    const log = fs.readFileSync(DEV_LOG).subarray(after).toString("utf8");
    const m = log.match(re);
    if (m) return log.slice(m.index, m.index + 1500);
    await sleep(150);
  }
  return null;
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
function sql(command) {
  for (let i = 0; i < 3; i++) {
    try {
      const out = execFileSync(process.env.WRANGLER || "wrangler", ["d1", "execute", "brain-vault-db", "--local", "--persist-to", process.env.PERSIST || ".wrangler/state", "--json", "--command", command], { encoding: "utf8", cwd: process.env.WORKER_DIR || process.cwd() });
      return JSON.parse(out)[0].results;
    } catch (e) {
      if (i === 2) throw e;
    }
  }
}
const read = (p) => JSON.parse(fs.readFileSync(new URL(p, import.meta.url)));
const ADMIN = "sf_sid=admin";
const PNG = Buffer.from("89504e470d0a1a0a0000000d4948445200000001000000010806000000" + "1f15c4890000000d49444154789c6360000002000154a24f5d0000000049454e44ae426082", "hex");
const cookieOf = (r) => (r.headers.getSetCookie().find((x) => x.startsWith("__Host-tv_session=")) || "").split(";")[0];

async function newClient(name, language, withBrain = true) {
  const email = "rs-" + name.toLowerCase().replace(/[^a-z]+/g, "-") + "-" + run + "@example.com";
  const mark = logSize();
  let r = await call("/admin/clients", { method: "POST", cookie: ADMIN, body: { name, email, language: "sv" } });
  const id = r.data.client.id;
  r = await call("/auth/verify", { method: "POST", body: { t: await linkFor(email, mark) } });
  const cookie = cookieOf(r);
  await call("/consent", { method: "POST", cookie, body: { accepted: true, language: "sv" } });
  r = await call("/uploads?section=pictures", { method: "POST", cookie, raw: PNG, headers: { "Content-Type": "image/png", "X-File-Name": "photo.png" } });
  const fixture = read("./fixtures/pilot-intake-v1.json");
  await call("/intake", { method: "PUT", cookie, body: { answerLanguage: "sv", campaignLanguage: language, profile: fixture.profile, uploads: { pictures: [{ fileId: r.data.file.id, name: "photo.png", mime: "image/png" }], founderStory: { text: "Story.", fileId: null }, previousPosts: [], faqs: { rows: [], fileId: null } } } });
  await call("/intake/submit", { method: "POST", cookie, body: {} });
  if (withBrain) {
    const brain = Object.assign(read("./fixtures/pilot-brain-v1.json"), { builtFromIntakeVersion: 1, editedByHarry: false });
    await call("/admin/brain/" + id, { method: "POST", cookie: ADMIN, body: { brain } });
  }
  return { id, email, cookie };
}
function campaign(clientId, month, extra) {
  const m = read("./fixtures/pilot-campaign-model.json");
  m.socialCopy = m.socialCopy.map((p) => (p.channel === "google_business" ? Object.assign(p, { hashtags: [] }) : p));
  return Object.assign({ schemaVersion: "campaign-1", clientId, campaignId: "cp_" + month.replace("-", "_") + "_en", brainVersion: 1, name: "Campaign " + month, month, goal: "sales", language: "en", channels: ["instagram", "facebook", "google_business"], status: "in_production" }, m, extra || {});
}
const deliver = (id, cp) => call("/admin/campaign/" + id + "/" + cp + "/status", { method: "PATCH", cookie: ADMIN, body: { status: "delivered", override: "test delivery" } });
const PLAN = { perMonth: 1, readyDay: 25, channels: ["instagram", "facebook"], goal: "sales", active: true, startMonth: "2026-10" };

try {
  /* ---------- the questions ---------- */
  const fr = fieldsFor("restaurant").map((f) => f.key), fs2 = fieldsFor("salon").map((f) => f.key), fo = fieldsFor("nonsense").map((f) => f.key);
  ok(fr.join() === "orders,newCustomers,redemptions,referrals,bestPost,said" && fs2[0] === "bookings" && fo[0] === "customers", "restaurant asks orders, salon bookings, others customers; then new customers, redemptions, referrals, best post, what customers said");
  ok(fieldsFor("restaurant").filter((f) => f.type !== "text").length === 5 && fieldsFor("salon").find((f) => f.key === "newCustomers").label === "New clients", "five questions per business type plus the free text; salons say new clients");
  let cr = cleanResults("restaurant", { orders: "120", newCustomers: 18, redemptions: "", bestPost: "instagram", said: "Fast — and hot" });
  ok(cr.errors.length === 0 && cr.values.orders === 120 && cr.values.redemptions === undefined && cr.values.said === "Fast, and hot", "answers are cleaned: numbers from text, empty left out, no em-dash");
  ok(cleanResults("restaurant", { orders: -3, referrals: "1.5", bestPost: "myspace" }).errors.length === 3, "negative or broken numbers and unknown posts are refused");
  ok(effective({ orders: 100, referrals: 2 }, { orders: 110 }).orders === 110 && effective({ orders: 100, referrals: 2 }, { orders: 110 }).referrals === 2, "Harry's value wins field by field; the client's other answers stay");
  ok(/orders or covers this month 110/.test(reportedText("restaurant", { orders: 110 }, "Rainy week")) && /Harry's note: Rainy week/.test(reportedText("restaurant", { orders: 110 }, "Rainy week")), "the prompt line names the numbers and Harry's note");
  ok(mainField("salon").key === "bookings", "the main number for a salon is bookings");

  /* ---------- business type on the plan ---------- */
  const A = await newClient("Resultat Kafé", "en");
  const B = await newClient("Resultat Salong", "en");
  let r = await call("/admin/plan/" + A.id, { cookie: ADMIN });
  ok(r.data.plan.niche === "other", "a new client's business type is other");
  r = await call("/admin/plan/" + A.id, { method: "PUT", cookie: ADMIN, body: { plan: Object.assign({}, PLAN, { niche: "bakery" }) } });
  ok(r.status === 400 && r.data.errors.some((e) => /niche/.test(e)), "an unknown business type is refused");
  r = await call("/admin/plan/" + A.id, { method: "PUT", cookie: ADMIN, body: { plan: Object.assign({}, PLAN, { niche: "restaurant" }) } });
  ok(r.status === 200 && r.data.plan.niche === "restaurant", "Harry sets the business type in the plan box");
  await call("/admin/plan/" + B.id, { method: "PUT", cookie: ADMIN, body: { plan: Object.assign({}, PLAN, { niche: "salon" }) } });

  /* October delivered, November in production, for A; one delivered for B. */
  await call("/admin/campaign/" + A.id, { method: "POST", cookie: ADMIN, body: { campaign: campaign(A.id, "2026-09") } });
  await call("/admin/campaign/" + A.id, { method: "POST", cookie: ADMIN, body: { campaign: campaign(A.id, "2026-10") } });
  await call("/admin/campaign/" + A.id, { method: "POST", cookie: ADMIN, body: { campaign: campaign(A.id, "2026-11") } });
  r = await deliver(A.id, "cp_2026_10_en");
  ok(r.status === 200, "October is delivered");
  await deliver(A.id, "cp_2026_09_en");
  await call("/admin/campaign/" + B.id, { method: "POST", cookie: ADMIN, body: { campaign: campaign(B.id, "2026-10") } });
  await deliver(B.id, "cp_2026_10_en");

  /* ---------- the portal asks ---------- */
  r = await call("/portal/results?today=2026-10-20", { cookie: A.cookie });
  ok(r.status === 200 && r.data.niche === "restaurant" && r.data.fields[0].key === "orders" && r.data.fields[0].main, "the portal gets her questions: orders first, as the main number");
  const oct = (d) => d.items.find((i) => i.campaignId === "cp_2026_10_en");
  ok(oct(r.data) && !oct(r.data).ask && !r.data.items.some((i) => i.campaignId === "cp_2026_11_en"), "on the 20th it does not ask yet, and a campaign in production is not listed");
  r = await call("/portal/results?today=2026-10-26", { cookie: A.cookie });
  ok(oct(r.data).ask && oct(r.data).channels.join() === "instagram,facebook,google_business", "from the 25th the portal asks How did it go?, with the campaign's channels for best post");
  r = await call("/portal/results?today=2027-01-02", { cookie: A.cookie });
  ok(!oct(r.data).ask, "after two months it stops asking");
  r = await call("/portal/results", { cookie: B.cookie });
  ok(r.data.niche === "salon" && r.data.items.every((i) => i.campaignId !== "cp_2026_09_en") && r.data.items.length === 1, "another client sees only her own campaigns and her own questions");

  r = await call("/portal/results/cp_2026_10_en", { method: "PUT", cookie: A.cookie, body: { values: { orders: "lots" } } });
  ok(r.status === 400 && r.data.message && r.data.message.sv && r.data.message.en, "a wrong number is refused in Swedish and English");
  r = await call("/portal/results/cp_2026_11_en", { method: "PUT", cookie: A.cookie, body: { values: { orders: 5 } } });
  ok(r.status === 409, "she cannot report on a campaign not delivered yet");
  r = await call("/portal/results/cp_2026_08_en", { method: "PUT", cookie: A.cookie, body: { values: { orders: 5 } } });
  ok(r.status === 404, "or on one that is not hers");
  let mark = logSize();
  r = await call("/portal/results/cp_2026_10_en", { method: "PUT", cookie: A.cookie, body: { values: { orders: "120", newCustomers: 18, redemptions: 31, referrals: 4, bestPost: "instagram", said: "The ndole sold out by Friday." } } });
  ok(r.status === 200 && r.data.values.orders === 120, "she reports her October numbers");
  const notice = await mailAfter(/Results: Resultat Kaf/, mark);
  ok(!!notice && /October 2026/.test(notice) && !/120|ndole/.test(notice), "Harry gets one email with company and month, no numbers or words");
  mark = logSize();
  r = await call("/portal/results/cp_2026_10_en", { method: "PUT", cookie: A.cookie, body: { values: { orders: 125, newCustomers: 18, referrals: 4, bestPost: "instagram", said: "The ndole sold out by Friday." } } });
  ok(r.status === 200 && !(await mailAfter(/Results: Resultat Kaf/, mark)), "she can change her numbers; no second email");
  r = await call("/portal/results?today=2026-10-26", { cookie: A.cookie });
  ok(oct(r.data).answered && !oct(r.data).ask && oct(r.data).values.orders === 125 && oct(r.data).values.redemptions === undefined, "answered: it stops asking and shows her latest answers");
  r = await call("/portal/results/cp_2026_10_en", { method: "PUT", cookie: B.cookie, body: { skip: true } });
  ok(r.status === 200 && r.data.skipped, "skip works");
  r = await call("/portal/results?today=2026-10-26", { cookie: B.cookie });
  ok(r.data.items[0].skipped && !r.data.items[0].ask, "a skipped campaign is not asked again");
  r = await call("/admin/results/" + A.id, { cookie: A.cookie });
  ok(r.status === 403, "a client cannot open the admin results");

  /* ---------- Harry's side ---------- */
  r = await call("/admin/results/" + A.id, { cookie: ADMIN });
  let it = r.data.items.find((i) => i.campaignId === "cp_2026_10_en");
  ok(r.status === 200 && r.data.mainKey === "orders" && it.client.orders === 125 && it.main === 125 && it.clientAt, "the Results box shows what she reported");
  r = await call("/admin/results/" + A.id + "/cp_2026_10_en", { method: "PUT", cookie: ADMIN, body: { values: { orders: 131, redemptions: 29 }, note: "Rainy fortnight — the reel carried it" } });
  ok(r.status === 200 && r.data.item.main === 131 && r.data.item.client.orders === 125 && r.data.item.values.newCustomers === 18 && r.data.item.note === "Rainy fortnight, the reel carried it", "Harry corrects: his number wins, hers is kept, the rest stays");
  await call("/admin/results/" + A.id + "/cp_2026_09_en", { method: "PUT", cookie: ADMIN, body: { values: { orders: 98 }, note: "" } });
  r = await call("/admin/results/" + A.id, { cookie: ADMIN });
  const mains = r.data.items.filter((i) => i.main != null).map((i) => i.month + ":" + i.main).sort().join();
  ok(mains === "2026-09:98,2026-10:131", "Harry can fill a month the client never answered; the chart has orders month by month");
  r = await call("/admin/results/" + A.id + "/cp_2026_10_en", { method: "PUT", cookie: ADMIN, body: { values: { orders: "x" } } });
  ok(r.status === 400, "Harry's numbers are checked too");
  r = await call("/portal/results?today=2026-10-26", { cookie: A.cookie });
  ok(oct(r.data).values.orders === 125 && !("note" in oct(r.data)), "the client still sees her own answer, never Harry's note");
  r = await call("/portal/results?today=2026-10-26", { cookie: A.cookie });
  ok(!r.data.items.find((i) => i.campaignId === "cp_2026_09_en").ask, "a month Harry already filled in is not asked");

  /* ---------- into the next campaign ---------- */
  r = await call("/admin/plan/" + A.id + "/last-results?before=2026-11", { cookie: ADMIN });
  ok(r.status === 200 && /the client reported orders or covers this month 131, new customers 18, offer redemptions 29, referrals 4, best performing post Instagram/.test(r.data.text), "{{LAST_RESULTS}} carries the reported numbers with Harry's corrections");
  ok(/customers said: "The ndole sold out by Friday\."/.test(r.data.text) && /Harry's note: Rainy fortnight, the reel carried it/.test(r.data.text), "and what customers said, and Harry's note");
  ok(/2026-09/.test(r.data.text) && /orders or covers this month 98/.test(r.data.text), "up to three months back");

  /* ---------- files ---------- */
  const i18n = JSON.parse(fs.readFileSync(new URL("../src/public/i18n.json", import.meta.url)));
  const keys = (o, p = "") => Object.keys(o).flatMap((k) => (typeof o[k] === "object" && !Array.isArray(o[k]) ? keys(o[k], p + k + ".") : [p + k]));
  ok(i18n.sv.results && keys(i18n.sv.results).join() === keys(i18n.en.results).join() && fieldsFor("salon").every((f) => i18n.en.results.fields[f.key]), "the portal has every results text in Swedish and English");
  const portal = fs.readFileSync(new URL("../src/public/portal.js", import.meta.url), "utf8");
  ok(/viewResults/.test(portal) && /inputmode: "numeric"/.test(portal) && /results\.skip/.test(portal), "the portal form uses number keyboards on phones and offers Skip");
  const files = ["../../../assets/growth-resultfields.js", "../../../assets/growth-results.js", "../src/results.js", "../src/public/portal.js", "../src/public/i18n.json"].map((f) => fs.readFileSync(new URL(f, import.meta.url), "utf8")).join("");
  ok(!files.includes("—"), "no em-dash in the new code and wording");

  /* ---------- export and erasure ---------- */
  r = await call("/admin/export/" + A.id, { cookie: ADMIN });
  ok(r.status === 200 && r.data.businessType === "restaurant" && r.data.reportedResults.some((x) => x.clientData && x.clientData.orders === 125 && x.harryData.orders === 131), "the export has the business type and both her answers and Harry's corrections");
  r = await call("/admin/clients/" + A.id, { method: "DELETE", cookie: ADMIN, body: { confirm: A.email } });
  ok(r.status === 200 && sql("SELECT COUNT(*) AS n FROM results WHERE client_id = '" + A.id + "'")[0].n === 0, "erasure removes the results");

  r = await call("/health");
  ok(/^[a-z0-9]+$/.test(r.data.part), "health reports the current part");
} catch (e) {
  fail++;
  console.log("FAIL crashed: " + e.stack);
}
console.log("\n" + pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
