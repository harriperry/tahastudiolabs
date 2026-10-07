/* V2 Part C test: the monthly rhythm. Plans (defaults, save, checks, roles), the due rule and
   Due list, skipped clients (left, paused, no brain), the reminder from the 20th (once a month,
   no client content), last results for {{LAST_RESULTS}}, the prompt placeholder, export and
   erasure. Same local setup as review.test.mjs (started by test/run-all.mjs). */
import fs from "node:fs";
import { execFileSync } from "node:child_process";
import { addMonths, defaultPlan, dueDateFor, nextDue, resultsText, stockholmDate, validatePlan } from "../src/rhythm-core.js";

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
  /* Retried only when the connection itself drops: the local server can restart for a moment
     right after the test reads or writes its database directly. App errors are never retried. */
  let r;
  for (let i = 0; ; i++) {
    try {
      r = await fetch(abs || BASE + path, { method, headers: h, body: raw !== undefined ? raw : body === undefined ? undefined : JSON.stringify(body), redirect: "manual" });
      break;
    } catch (e) {
      if (i >= 8) throw e;
      await sleep(1000);
    }
  }
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
  const email = "rh-" + name.toLowerCase().replace(/[^a-z]+/g, "-") + "-" + run + "@example.com";
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
const WORKER = "http://127.0.0.1:8787";
async function scheduled() {
  for (let i = 0; i < 8; i++) {
    try { const r = await fetch(WORKER + "/__scheduled?cron=17+3+*+*+*"); if (r.ok) return; } catch (e) {}
    await sleep(1000);
  }
  throw new Error("the scheduled handler did not answer");
}
const setClock = (iso) => sql("INSERT INTO job_runs (name, period, at) VALUES ('dev-clock', '" + iso + "', 'x') ON CONFLICT(name) DO UPDATE SET period = excluded.period");
const rhythm = (today) => call("/admin/rhythm?today=" + today, { cookie: ADMIN });
const itemOf = (r, id) => r.data.items.find((i) => i.clientId === id);

try {
  /* ---------- the rules, as plain functions ---------- */
  const p = defaultPlan("2026-10-02T10:00:00Z", "2026-10");
  ok(p.perMonth === 1 && p.readyDay === 25 && p.goal === "sales" && p.channels.join() === "instagram,facebook,google_business" && p.active && p.startMonth === "2026-11", "defaults: 1 a month, ready on the 25th, Instagram, Facebook, Google Business, goal sales, from the month after joining");
  ok(dueDateFor("2026-11", 25) === "2026-10-25" && dueDateFor("2027-01", 25) === "2026-12-25" && addMonths("2026-12", 1) === "2027-01", "a month's campaign is due on the ready day of the month before, across the year end");
  let n = nextDue(p, { "2026-10": 1 }, "2026-10-06");
  ok(n.month === "2026-11" && n.dueDate === "2026-10-25" && n.daysLeft === 19 && !n.overdue, "on 6 October the November campaign is due in 19 days");
  n = nextDue(p, { "2026-10": 1 }, "2026-10-20");
  ok(n.daysLeft === 5, "on 20 October it is due in 5 days");
  n = nextDue(p, {}, "2026-10-27");
  ok(n.overdue && n.daysLeft === -2, "two days after the ready day it is late");
  ok(nextDue(p, { "2026-11": 1 }, "2026-10-27") === null, "a client whose next month is made is on track");
  ok(nextDue(Object.assign({}, p, { perMonth: 2 }), { "2026-11": 1 }, "2026-10-21").have === 1 && nextDue(Object.assign({}, p, { perMonth: 2 }), { "2026-11": 1 }, "2026-10-21").need === 2, "two a month: one made still leaves the month due");
  n = nextDue(Object.assign({}, p, { startMonth: "2026-10" }), {}, "2026-10-06");
  ok(n.month === "2026-10" && n.overdue, "a month that has started without its campaign counts first, and is late");
  ok(stockholmDate(Date.UTC(2026, 9, 19, 22, 30)).iso === "2026-10-20", "the date is Stockholm's: 00:30 on the 20th there is still the 19th in UTC");
  ok(validatePlan({ perMonth: 5, readyDay: 29, channels: ["fax"], goal: "x", active: "yes", startMonth: "2026-13" }).errors.length === 6, "plan checks: per month 1 to 4, day 1 to 28, known channels and goal, true or false, a real month");
  ok(/No results yet/.test(resultsText([])), "no earlier campaigns: the prompt says to write from the brain alone");

  /* ---------- plans through the Vault ---------- */
  const A = await newClient("Rytm Kafé", "en");
  const B = await newClient("Rytm Salong", "en");
  const C = await newClient("Rytm Utan Hjärna", "en", false);
  let r = await call("/admin/plan/" + A.id, { cookie: A.cookie });
  ok(r.status === 403, "a client cannot read a plan");
  r = await call("/admin/rhythm", { cookie: A.cookie });
  ok(r.status === 403, "a client cannot read the Due list");
  r = await call("/admin/plan/" + A.id, { cookie: ADMIN });
  ok(r.status === 200 && r.data.plan.saved === false && r.data.plan.perMonth === 1 && r.data.plan.readyDay === 25, "an unsaved plan answers with the defaults");
  r = await call("/admin/plan/" + A.id, { method: "PUT", cookie: ADMIN, body: { plan: { perMonth: 1, readyDay: 40, channels: ["instagram"], goal: "sales", active: true, startMonth: "2026-11" } } });
  ok(r.status === 400 && r.data.errors.some((e) => /readyDay/.test(e)), "a wrong plan is refused with the reason");
  const thisMonth = new Date().toISOString().slice(0, 7);
  r = await call("/admin/plan/" + A.id, { method: "PUT", cookie: ADMIN, body: { plan: { perMonth: 1, readyDay: 25, channels: ["facebook", "instagram"], goal: "bookings", active: true, startMonth: "2026-11" } } });
  ok(r.status === 200 && r.data.plan.saved && r.data.plan.goal === "bookings" && r.data.plan.channels.join() === "instagram,facebook", "Harry saves a plan; channels keep the panel's order");
  await call("/admin/plan/" + B.id, { method: "PUT", cookie: ADMIN, body: { plan: { perMonth: 1, readyDay: 15, channels: ["instagram"], goal: "sales", active: true, startMonth: "2026-11" } } });

  /* October campaigns exist for both; November for neither. */
  await call("/admin/campaign/" + A.id, { method: "POST", cookie: ADMIN, body: { campaign: campaign(A.id, "2026-10") } });
  await call("/admin/campaign/" + B.id, { method: "POST", cookie: ADMIN, body: { campaign: campaign(B.id, "2026-10") } });

  r = await rhythm("2026-10-06");
  ok(r.status === 200 && itemOf(r, A.id).next.month === "2026-11" && itemOf(r, A.id).next.daysLeft === 19 && !r.data.due.some((i) => i.clientId === A.id), "on 6 October Kafé is not yet in the Due list (19 days)");
  ok(itemOf(r, B.id).next.daysLeft === 9 && !r.data.due.some((i) => i.clientId === B.id), "Salong, ready on the 15th, is due in 9 days, not yet listed");
  ok(itemOf(r, C.id).skip === "no_brain" && !itemOf(r, C.id).next, "a client without a Business Brain is skipped");
  r = await rhythm("2026-10-20");
  const due = r.data.due.map((i) => i.clientId);
  ok(due.includes(A.id) && due.includes(B.id), "on 20 October both are in the Due list");
  ok(r.data.due[0].clientId === B.id && r.data.due[0].next.overdue && r.data.due[0].next.daysLeft === -5, "Salong is late by 5 days and listed first");
  ok(r.data.due.find((i) => i.clientId === A.id).goal === "bookings" && r.data.due.find((i) => i.clientId === A.id).channels.join() === "instagram,facebook", "a due entry carries the plan's goal and channels for the generator");

  /* Pause and leave */
  await call("/admin/plan/" + B.id, { method: "PUT", cookie: ADMIN, body: { plan: { perMonth: 1, readyDay: 15, channels: ["instagram"], goal: "sales", active: false, startMonth: "2026-11" } } });
  r = await rhythm("2026-10-20");
  ok(itemOf(r, B.id).skip === "paused" && !r.data.due.some((i) => i.clientId === B.id), "a paused plan leaves the Due list");
  await call("/admin/plan/" + B.id, { method: "PUT", cookie: ADMIN, body: { plan: { perMonth: 1, readyDay: 15, channels: ["instagram"], goal: "sales", active: true, startMonth: "2026-11" } } });
  await call("/admin/clients/" + B.id + "/left", { method: "POST", cookie: ADMIN, body: { left: true } });
  r = await rhythm("2026-10-20");
  ok(itemOf(r, B.id).skip === "left" && !r.data.due.some((i) => i.clientId === B.id), "a client marked as left is skipped");
  await call("/admin/clients/" + B.id + "/left", { method: "POST", cookie: ADMIN, body: { left: false } });

  /* Making the campaign clears it */
  await call("/admin/campaign/" + A.id, { method: "POST", cookie: ADMIN, body: { campaign: campaign(A.id, "2026-11") } });
  r = await rhythm("2026-10-20");
  ok(!r.data.due.some((i) => i.clientId === A.id) && itemOf(r, A.id).next === null, "once November is saved, Kafé leaves the Due list");

  /* ---------- the reminder on the 20th ---------- */
  setClock("2026-10-19");
  let mark = logSize();
  await scheduled();
  ok(!(await mailAfter(/Campaigns due/, mark)), "no reminder before the 20th");
  setClock("2026-10-20");
  mark = logSize();
  await scheduled();
  const mail = await mailAfter(/\[dev mail\] to=[^\n]*\n?[\s\S]{0,200}Campaigns due/, mark) || await mailAfter(/Campaigns due/, mark);
  ok(!!mail && /Rytm Salong/.test(mail) && !/Rytm Kafé/.test(mail), "on the 20th Harry gets one email listing who is due (Salong), not who is on track (Kafé)");
  ok(!!mail && /5 dagar sen|5 days late/.test(mail), "late campaigns say how late");
  const camp = campaign(A.id, "2026-11");
  ok(!!mail && !mail.includes(camp.concept.bigIdea || "@@") && !mail.includes(camp.hook ? (camp.hook.primary || camp.hook.text || "@@") : "@@") && !/socialCopy|Refer 10/.test(mail), "the reminder has no client content, only names and dates");
  mark = logSize();
  await scheduled();
  ok(!(await mailAfter(/Campaigns due/, mark)), "the reminder goes once a month, not every day");
  setClock("2026-11-20");
  mark = logSize();
  await scheduled();
  ok(!!(await mailAfter(/Campaigns due/, mark)), "next month it comes again");
  sql("DELETE FROM job_runs WHERE name = 'dev-clock'");

  /* ---------- last results for the prompt ---------- */
  r = await call("/admin/plan/" + A.id + "/last-results?before=2026-12", { cookie: ADMIN });
  ok(r.status === 200 && r.data.results.length === 2 && r.data.results[0].month === "2026-11" && /Campaign 2026-11/.test(r.data.text), "last results: the earlier campaigns, newest first, as text for the prompt");
  ok(/no landing page tracked/.test(r.data.text), "a campaign without a page says so instead of inventing numbers");
  await call("/admin/baseline/" + A.id + "/cp_2026_10_en", { method: "PUT", cookie: ADMIN, body: { before: { orders: 100, new_customers: 10 }, after: { orders: 125, new_customers: 18 } } });
  r = await call("/admin/plan/" + A.id + "/last-results?before=2026-11", { cookie: ADMIN });
  ok(r.data.results.length === 1 && /orders \+25%/.test(r.data.text) && /new customers: 18/.test(r.data.text), "before and after numbers Harry entered go into the results");
  r = await call("/admin/plan/" + A.id + "/last-results", { cookie: C.cookie });
  ok(r.status === 403, "a client cannot read results here");

  /* ---------- the prompt and the panel files ---------- */
  const prompt = JSON.parse(fs.readFileSync(new URL("../../../assets/growth/campaign.prompt.json", import.meta.url)));
  ok(prompt.user.some((l) => l === "{{LAST_RESULTS}}") && prompt.user.some((l) => /Keep what worked, change what did not/.test(l)), "the Campaign Generator prompt has {{LAST_RESULTS}} and the keep-what-worked rule");
  const gc = fs.readFileSync(new URL("../../../assets/growth-campaign.js", import.meta.url), "utf8");
  const gj = fs.readFileSync(new URL("../../../assets/growth.js", import.meta.url), "utf8");
  ok(/LAST_RESULTS:/.test(gc) && /last-results\?before=/.test(gc) && /Start next month's campaign/.test(gc + gj) && /\/admin\/rhythm/.test(gj), "the panel fetches the Due list, last results, and offers Start next month's campaign");
  ok(!(gc + gj + fs.readFileSync(new URL("../src/rhythm.js", import.meta.url), "utf8") + fs.readFileSync(new URL("../src/rhythm-core.js", import.meta.url), "utf8")).includes("\u2014"), "no em-dash in the new code");

  /* ---------- export and erasure ---------- */
  r = await call("/admin/export/" + A.id, { cookie: ADMIN });
  ok(r.status === 200 && r.data.monthlyPlan && r.data.monthlyPlan.goal === "bookings", "the client's export includes the monthly plan");
  r = await call("/admin/clients/" + A.id, { method: "DELETE", cookie: ADMIN, body: { confirm: A.email } });
  ok(r.status === 200 && sql("SELECT COUNT(*) AS n FROM plans WHERE client_id = '" + A.id + "'")[0].n === 0, "erasure removes the plan");

  r = await call("/health");
  ok(/^[a-z0-9]+$/.test(r.data.part), "health reports the current part");
} catch (e) {
  fail++;
  console.log("FAIL crashed: " + e.stack);
}
console.log("\n" + pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
