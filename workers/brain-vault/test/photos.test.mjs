/* V2 phase G2a test: photo requests from the Visual Pack to the client portal.
   Same local setup as visuals.test.mjs (Vault behind the local site on port 8080, started by
   test/run-all.mjs). */
import fs from "node:fs";
import { execFileSync } from "node:child_process";
import { buildSlots, normalizeVisuals, withVisuals } from "../../../assets/growth-visuals.js";

const BASE = process.env.VAULT_URL || "http://127.0.0.1:8080/api/vault";
const ORIGIN = process.env.ORIGIN || "http://localhost:8080";
const DEV_LOG = process.env.DEV_LOG;
const run = Date.now().toString(36);
let pass = 0, fail = 0;
const ok = (c, n) => { if (c) { pass++; console.log("PASS " + n); } else { fail++; console.log("FAIL " + n); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function call(path, { method = "GET", body, raw, headers = {}, cookie, origin = ORIGIN } = {}) {
  const h = Object.assign({ Accept: "application/json" }, headers);
  if (body !== undefined) h["Content-Type"] = "application/json";
  if (cookie) h.Cookie = cookie;
  if (origin && method !== "GET") h.Origin = origin;
  const r = await fetch(BASE + path, { method, headers: h, body: raw !== undefined ? raw : body === undefined ? undefined : JSON.stringify(body), redirect: "manual" });
  const text = await r.text();
  let data = null;
  try { data = JSON.parse(text); } catch (e) {}
  return { status: r.status, data, headers: r.headers };
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
const platforms = read("../../../assets/growth/platforms.json");
const prompt = read("../../../assets/growth/visuals.prompt.json");
const PNG = Buffer.from("89504e470d0a1a0a0000000d4948445200000001000000010806000000" + "1f15c4890000000d49444154789c6360000002000154a24f5d0000000049454e44ae426082", "hex");

async function newClient(name) {
  const email = "pr-" + name.toLowerCase().replace(/[^a-z]+/g, "-") + "-" + run + "@example.com";
  const mark = logSize();
  let r = await call("/admin/clients", { method: "POST", cookie: ADMIN, body: { name, email, language: "en" } });
  const id = r.data.client.id;
  r = await call("/auth/verify", { method: "POST", body: { t: await linkFor(email, mark) } });
  const cookie = (r.headers.getSetCookie().find((x) => x.startsWith("__Host-tv_session=")) || "").split(";")[0];
  await call("/consent", { method: "POST", cookie, body: { accepted: true, language: "en" } });
  return { id, email, cookie };
}
async function upload(cookie, q) {
  return call("/uploads?section=pictures" + (q || ""), { method: "POST", cookie, raw: PNG, headers: { "Content-Type": "image/png", "X-File-Name": "photo.png" } });
}

try {
  const A = await newClient("Photo Kitchen");
  const B = await newClient("Other Salon");
  let r = await upload(A.cookie);
  const pic = r.data.file.id;
  const fixture = read("./fixtures/pilot-intake-v1.json");
  await call("/intake", { method: "PUT", cookie: A.cookie, body: { answerLanguage: "en", campaignLanguage: "en", profile: fixture.profile, uploads: { pictures: [{ fileId: pic, name: "photo.png", mime: "image/png" }], founderStory: { text: "Story.", fileId: null }, previousPosts: [], faqs: { rows: [], fileId: null } } } });
  await call("/intake/submit", { method: "POST", cookie: A.cookie, body: {} });
  const brain = Object.assign(read("./fixtures/pilot-brain-v1.json"), { builtFromIntakeVersion: 1, editedByHarry: false });
  await call("/admin/brain/" + A.id, { method: "POST", cookie: ADMIN, body: { brain } });

  /* A campaign whose product shots have no fitting photo: they need one from the client. */
  const m = read("./fixtures/pilot-campaign-model.json");
  m.socialCopy = m.socialCopy.map((p) => (p.channel === "google_business" ? Object.assign(p, { hashtags: [] }) : p));
  const base = Object.assign({ schemaVersion: "campaign-1", clientId: A.id, campaignId: "cp_2026_10_en", brainVersion: 1, name: "A Little Extra", month: "2026-10", goal: "sales", language: "en", channels: ["instagram", "facebook", "google_business"], status: "in_production" }, m);
  const slots = buildSlots(base, platforms);
  const raw = { visuals: slots.map((s) => {
    const product = /offer|social|gbp/.test(s.id);
    return {
      id: s.id, subject: product ? "product" : "mood", source: product ? "client_photo" : "ai_image", photo_ref: null, cast: "",
      prompt: product ? "Ask for a close, daylight photo of two plated mains side by side, portrait." : "Warm evening table, top fifth empty. " + prompt.noTextSentence,
      avoid: "text", overlay: { headline: "A little extra", sub: "Two mains, free bites", cta: "Order now" },
      alt_text: { sv: "Mat på ett bord.", en: "Food on a table." },
      photo_request: product ? { sv: "Ta en nära bild i dagsljus av två rätter bredvid varandra, på höjden.", en: "Take a close photo in daylight of two dishes side by side, upright." } : undefined
    };
  }) };
  const out = normalizeVisuals(raw, slots, { photoIds: [pic], language: "en", noTextSentence: prompt.noTextSentence, avoidDefault: prompt.avoidDefault });
  const camp = withVisuals(base, out.visuals);
  r = await call("/admin/campaign/" + A.id, { method: "POST", cookie: ADMIN, body: { campaign: camp } });
  ok(r.status === 201 && r.data.campaign.visuals.filter((v) => v.photo_request).length >= 3, "a Visual Pack with photo-needed briefs and their requests is saved");
  const needed = r.data.campaign.visuals.filter((v) => v.source === "client_photo" && !v.photo_ref);
  const notNeeded = r.data.campaign.visuals.find((v) => v.source === "ai_image");
  const P = "/admin/photo-requests/" + A.id + "/cp_2026_10_en";

  /* Roles and checks */
  r = await call(P, { method: "POST", cookie: A.cookie, body: { requests: [{ visualId: needed[0].id }] } });
  ok(r.status === 403, "a client cannot send photo requests");
  r = await call(P, { method: "POST", cookie: ADMIN, body: { requests: [{ visualId: needed[0].id }] }, origin: "https://evil.example" });
  ok(r.status === 403, "photo requests sent from another site are refused");
  r = await call(P, { method: "POST", cookie: ADMIN, body: { requests: [{ visualId: notNeeded.id, text: { en: "x" } }] } });
  ok(r.status === 400 && r.data.error === "not_needed", "a brief that does not need a client photo cannot be requested");
  r = await call(P, { method: "POST", cookie: ADMIN, body: { requests: [{ visualId: needed[0].id, text: { en: "sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789" } }] } });
  ok(r.status === 400 && r.data.error === "api_key", "a request text that looks like a key is refused");

  /* Send */
  let mark = logSize();
  const items = needed.map((v) => ({ visualId: v.id, text: v.photo_request }));
  r = await call(P, { method: "POST", cookie: ADMIN, body: { requests: items } });
  ok(r.status === 201 && r.data.created === needed.length && r.data.emailed, "one click sends a request for every photo-needed brief");
  const mail = await mailAfter(new RegExp("\\[dev mail\\] to=" + A.email.replace(/[.+]/g, "\\$&") + " subject=We need a few photos from you / Vi behöver"), mark);
  ok(!!mail && /#photos/.test(mail) && !/dishes|two mains|rätter/i.test(mail), "the client gets one email with a portal link and no campaign content");
  r = await call(P, { method: "POST", cookie: ADMIN, body: { requests: items.slice(0, 1).map((x) => ({ visualId: x.visualId, text: { en: "Updated wording", sv: "" } })) } });
  ok(r.status === 200 && r.data.created === 0 && r.data.updated === 1 && !r.data.emailed, "sending again updates the open request instead of a second one, with no new email");

  /* Portal */
  r = await call("/portal/photo-requests", { cookie: A.cookie });
  ok(r.status === 200 && r.data.requests.length === needed.length && r.data.requests.every((x) => x.state === "open" && x.campaignName === "A Little Extra"), "the client sees her open requests with the campaign name");
  ok(r.data.requests.some((x) => x.text.en === "Updated wording") && r.data.requests.some((x) => /dagsljus/.test(x.text.sv)), "the request text is there in English and Swedish");
  const reqs = r.data.requests;
  r = await call("/portal/photo-requests", { cookie: B.cookie });
  ok(r.status === 200 && r.data.requests.length === 0, "another client never sees these requests");
  r = await upload(B.cookie, "&request=" + reqs[0].id);
  ok(r.status === 409, "another client cannot answer them");
  r = await call("/portal/photo-requests", { cookie: ADMIN });
  ok(r.status === 403, "the portal list is for clients only");

  /* Answer */
  mark = logSize();
  const target = reqs.find((x) => x.visualId === needed[0].id);
  r = await upload(A.cookie, "&request=" + target.id);
  ok(r.status === 201 && r.data.request && r.data.request.state === "received" && r.data.request.briefUpdated, "her upload answers the request");
  const answerFile = r.data.file.id;
  const notice = await mailAfter(/\[dev mail\] to=agborkak@gmail\.com subject=Ny bild \/ New photo: Photo Kitchen/, mark);
  ok(!!notice && !/dishes|two mains/i.test(notice), "Harry gets a notice with the company name only");
  r = await call("/admin/campaign/" + A.id + "/cp_2026_10_en", { cookie: ADMIN });
  const brief = r.data.campaign.visuals.find((v) => v.id === needed[0].id);
  ok(brief.photo_ref === answerFile && brief.source === "client_photo", "the brief now uses her photo (Client photo, not Photo needed)");
  r = await upload(A.cookie, "&request=" + target.id);
  ok(r.status === 409, "a request is answered once");
  r = await call(P, { cookie: ADMIN });
  ok(r.status === 200 && r.data.requests.find((x) => x.id === target.id).state === "received" && r.data.requests.find((x) => x.id === target.id).fileId === answerFile, "the panel list shows it received, with the file");

  /* Cancel and delete */
  const other = reqs.find((x) => x.id !== target.id);
  r = await call(P + "/" + other.id, { method: "DELETE", cookie: ADMIN });
  ok(r.status === 200, "an open request can be cancelled");
  r = await call("/portal/photo-requests", { cookie: A.cookie });
  ok(!r.data.requests.some((x) => x.id === other.id), "a cancelled request leaves the portal");
  r = await call(P + "/" + target.id, { method: "DELETE", cookie: ADMIN });
  ok(r.status === 409, "an answered request cannot be cancelled");
  r = await call("/files/" + answerFile, { method: "DELETE", cookie: A.cookie });
  ok(r.status === 200, "she can still delete her photo");
  r = await call("/admin/campaign/" + A.id + "/cp_2026_10_en", { cookie: ADMIN });
  ok(r.data.campaign.visuals.find((v) => v.id === needed[0].id).photo_ref === null, "then the brief goes back to Photo needed from client");
  r = await call("/portal/photo-requests", { cookie: A.cookie });
  ok(r.data.requests.find((x) => x.id === target.id).state === "open", "and the request opens again");

  /* Export and erasure */
  r = await call("/admin/export/" + A.id, { cookie: ADMIN });
  ok(r.status === 200 && r.data.photoRequests.length === needed.length, "the export lists the photo requests");
  r = await call("/admin/clients/" + A.id, { method: "DELETE", cookie: ADMIN, body: { confirm: A.email } });
  ok(r.status === 200 && r.data.remaining.rows === 0, "erasure leaves nothing");
  ok(sql("SELECT COUNT(*) AS n FROM photo_requests WHERE client_id = '" + A.id + "'")[0].n === 0, "no photo requests remain");
} catch (e) {
  fail++;
  console.log("FAIL crashed: " + e.stack);
}
console.log("\n" + pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
