/* End to end test of the phase 2 client portal endpoints against a local `wrangler dev`.
   Same setup as e2e.test.mjs (MAIL_PROVIDER=log, SITE_ORIGIN=http://localhost:8787).
     DEV_LOG=/path/to/dev.log node test/portal.test.mjs */
import fs from "node:fs";
import crypto from "node:crypto";

const BASE = process.env.VAULT_URL || "http://127.0.0.1:8787/api/vault";
const ROOT = BASE.replace(/\/api\/vault$/, "");
const ORIGIN = process.env.ORIGIN || "http://localhost:8787";
const DEV_LOG = process.env.DEV_LOG;
const ADMIN = "agborkak@gmail.com";
const run = Date.now().toString(36);
let pass = 0;
let fail = 0;
const ok = (c, n) => { if (c) { pass++; console.log("PASS " + n); } else { fail++; console.log("FAIL " + n); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let ipn = crypto.randomInt(1, 250);
const nextIp = () => "10.50." + crypto.randomInt(1, 250) + "." + (ipn++ % 250);

async function call(path, { method = "GET", body, raw, headers = {}, cookie, origin = ORIGIN } = {}) {
  const h = { Accept: "application/json", ...headers };
  if (body !== undefined) h["Content-Type"] = "application/json";
  if (cookie) h.Cookie = cookie;
  if (origin && method !== "GET") h.Origin = origin;
  const r = await fetch(BASE + path, { method, headers: h, body: raw !== undefined ? raw : body === undefined ? undefined : JSON.stringify(body), redirect: "manual" });
  const text = await r.text();
  let data = null;
  try { data = JSON.parse(text); } catch (e) {}
  return { status: r.status, data, text, headers: r.headers };
}
const logSize = () => fs.statSync(DEV_LOG).size;
async function linkFor(email, after) {
  for (let i = 0; i < 40; i++) {
    const log = fs.readFileSync(DEV_LOG).subarray(after).toString("utf8");
    const re = new RegExp("\\[dev mail\\] to=" + email.replace(/[.+]/g, "\\$&") + "[\\s\\S]*?#t=([A-Za-z0-9_-]+)", "g");
    let m, last = null;
    while ((m = re.exec(log))) last = m[1];
    if (last) return last;
    await sleep(150);
  }
  return null;
}
async function signIn(email) {
  const mark = logSize();
  await call("/auth/request-link", { method: "POST", body: { email }, headers: { "CF-Connecting-IP": nextIp() } });
  const tok = await linkFor(email, mark);
  const r = await call("/auth/verify", { method: "POST", body: { t: tok } });
  const c = (r.headers.getSetCookie() || []).find((x) => x.startsWith("__Host-tv_session="));
  return { cookie: c ? c.split(";")[0] : null, redirect: r.data && r.data.redirect };
}
async function invite(admin, name, email) {
  const mark = logSize();
  const r = await call("/admin/clients", { method: "POST", cookie: admin, body: { name, email, language: "sv" } });
  const tok = await linkFor(email, mark);
  const v = await call("/auth/verify", { method: "POST", body: { t: tok } });
  const c = (v.headers.getSetCookie() || []).find((x) => x.startsWith("__Host-tv_session="));
  return { id: r.data.client.id, cookie: c.split(";")[0], redirect: v.data.redirect };
}
const PNG = Buffer.from("89504e470d0a1a0a0000000d4948445200000001000000010806000000" + "1f15c4890000000d49444154789c6360000002000154a24f5d0000000049454e44ae426082", "hex");
function upload(cookie, section, name, bytes, type) {
  return call("/uploads?section=" + section, { method: "POST", cookie, raw: bytes, headers: { "Content-Type": type, "X-File-Name": encodeURIComponent(name) } });
}
function answers(fileIds = {}) {
  return {
    answerLanguage: "sv",
    campaignLanguage: "",
    profile: {
      companyName: "Testbageriet " + run,
      website: "",
      location: "",
      productService: "Surdegsbröd",
      targetAudience: "",
      brandVoice: { text: "", toneChips: ["warm"] },
      usp: "",
      offers: [{ offer: "Bulle på köpet", priceOrDiscount: "0 kr", validUntil: "2026-10-31" }],
      competitors: [],
      reviews: { pasted: ["Bästa brödet!"], fileIds: [] },
      brandWords: { use: ["nybakat"], avoid: ["billig"] }
    },
    uploads: {
      pictures: fileIds.pic ? [{ fileId: fileIds.pic, name: "p.png", mime: "image/png" }] : [],
      founderStory: { text: "Jag startade 2020.", fileId: null },
      previousPosts: [{ type: "link", value: "https://instagram.com/p/x" }],
      faqs: { rows: [{ q: "Öppet?", a: "Ja" }], fileId: null }
    }
  };
}

try {
  let r = await fetch(ROOT + "/grow", { redirect: "manual" });
  ok(r.status === 301 && /\/grow\/$/.test(r.headers.get("location") || ""), "/grow redirects to /grow/");
  r = await fetch(ROOT + "/grow/");
  ok(r.status === 200 && (r.headers.get("content-security-policy") || "").includes("script-src 'self'"), "portal page served with CSP");
  r = await fetch(ROOT + "/grow/i18n.json");
  const dict = await r.json();
  ok(dict.sv && dict.en && dict.sv.consent && dict.en.consent, "i18n.json has Swedish and English");
  ok(!/\u2014/.test(JSON.stringify(dict)), "i18n.json has no em-dash");
  r = await call("/portal/meta");
  ok(r.status === 200 && r.data.productName === "TAHA Studio Labs Growth Department", "product name is TAHA Studio Labs Growth Department");

  const admin = (await signIn(ADMIN)).cookie;
  ok(!!admin, "admin signed in");
  const A = await invite(admin, "Kund A", "kund-a-" + run + "@example.com");
  const B = await invite(admin, "Kund B", "kund-b-" + run + "@example.com");
  ok(A.redirect === "/grow/", "client lands on /grow/ after the magic link");

  r = await call("/portal/state", { cookie: A.cookie });
  ok(r.status === 200 && r.data.consent.accepted === false && r.data.consent.retentionMonths === 6, "state: consent not yet given, retention 6 months");
  r = await call("/intake", { method: "PUT", cookie: A.cookie, body: answers() });
  ok(r.status === 403, "cannot save answers before consent");
  r = await upload(A.cookie, "pictures", "p.png", PNG, "image/png");
  ok(r.status === 403, "cannot upload before consent");
  r = await call("/consent", { method: "POST", cookie: A.cookie, body: { accepted: true, language: "sv" } });
  ok(r.status === 200 && r.data.version === "c-1", "consent recorded with version c-1");
  await call("/consent", { method: "POST", cookie: B.cookie, body: { accepted: true, language: "en" } });
  r = await call("/portal/state", { cookie: A.cookie });
  ok(r.data.consent.accepted === true, "state shows consent accepted");

  r = await call("/intake", { method: "PUT", cookie: A.cookie, body: answers() });
  ok(r.status === 200, "draft auto-save works");
  r = await call("/intake", { cookie: A.cookie });
  ok(r.data.draft.profile.companyName === "Testbageriet " + run && r.data.draft.consent.version === "c-1", "saved answers come back (resume after closing browser)");
  r = await call("/status", { cookie: A.cookie });
  ok(r.data.status === "profile_in_progress", "status moves to Profile in progress on first save");
  const bad = answers();
  bad.apiKey = "sk-ant-test";
  r = await call("/intake", { method: "PUT", cookie: A.cookie, body: bad });
  ok(r.status === 200, "unknown top-level fields are dropped by the server, never stored");
  r = await call("/intake", { cookie: A.cookie });
  ok(!JSON.stringify(r.data).includes("sk-ant"), "no API key text stored in the draft");
  const bad2 = answers();
  bad2.profile.secret = "x";
  r = await call("/intake", { method: "PUT", cookie: A.cookie, body: bad2 });
  ok(r.status === 400, "unknown profile fields are rejected by the schema");

  r = await upload(A.cookie, "pictures", "p.png", PNG, "image/png");
  ok(r.status === 201 && /^f_/.test(r.data.file.id), "picture upload works");
  const picId = r.data.file.id;
  r = await upload(A.cookie, "pictures", "clip.mp4", Buffer.from("00000018667479706d703432", "hex"), "video/mp4");
  ok(r.status === 415 && r.data.message.sv && r.data.message.en, "video refused with a bilingual message");
  r = await upload(A.cookie, "pictures", "fake.png", Buffer.from("not really a png"), "image/png");
  ok(r.status === 415, "renamed file with wrong content refused");
  r = await upload(A.cookie, "pictures", "tool.exe", Buffer.from("MZ"), "application/octet-stream");
  ok(r.status === 415, "unsupported type refused");
  const big = Buffer.alloc(10 * 1024 * 1024 + 10, 0);
  PNG.copy(big);
  r = await upload(A.cookie, "pictures", "big.png", big, "image/png");
  ok(r.status === 413, "picture over 10 MB refused");
  r = await upload(A.cookie, "founderStory", "story.txt", Buffer.from("Min berättelse"), "text/plain");
  ok(r.status === 201, "founder story text file accepted");
  const storyId = r.data.file.id;
  r = await upload(A.cookie, "founderStory", "story2.txt", Buffer.from("igen"), "text/plain");
  ok(r.status === 409, "only one founder story file allowed");

  r = await fetch(BASE + "/files/" + picId, { headers: { Cookie: A.cookie } });
  ok(r.status === 200 && r.headers.get("content-type") === "image/png", "client can view its own picture");
  r = await fetch(BASE + "/files/" + picId, { headers: { Cookie: B.cookie } });
  ok(r.status === 404, "another client cannot view it");
  r = await call("/files/" + picId, { method: "DELETE", cookie: B.cookie });
  ok(r.status === 404, "another client cannot delete it");
  const steal = answers({ pic: picId });
  r = await call("/intake", { method: "PUT", cookie: B.cookie, body: steal });
  ok(r.status === 400, "another client cannot attach it to its own intake");
  r = await fetch(BASE + "/files/" + picId, { headers: { Cookie: admin } });
  ok(r.status === 200, "admin can view client files");

  const withPic = answers({ pic: picId });
  withPic.uploads.founderStory.fileId = storyId;
  r = await call("/intake", { method: "PUT", cookie: A.cookie, body: withPic });
  ok(r.status === 200, "draft with picture and story file saved");
  r = await call("/intake/submit", { method: "POST", cookie: A.cookie, body: {} });
  ok(r.status === 400 && r.data.missing.includes("profile.location") && r.data.missing.includes("campaignLanguage"), "submit refused while required fields are missing");

  const full = answers({ pic: picId });
  full.uploads.founderStory.fileId = storyId;
  Object.assign(full.profile, { location: "Örebro", targetAudience: "Familjer", usp: "Allt bakat på morgonen" });
  full.profile.brandVoice.text = "Varm och rak";
  full.campaignLanguage = "both";
  r = await call("/intake", { method: "PUT", cookie: A.cookie, body: full });
  ok(r.status === 200, "complete draft saved");
  let mark = logSize();
  r = await call("/intake/submit", { method: "POST", cookie: A.cookie, body: {} });
  ok(r.status === 200 && r.data.intakeVersion === 1 && r.data.status === "submitted", "submit creates intake version 1");
  await sleep(400);
  const notice = fs.readFileSync(DEV_LOG).subarray(mark).toString("utf8");
  ok(/\[dev mail\] to=agborkak@gmail\.com subject=Ny inskickning \/ New intake: Testbageriet/.test(notice), "Harry is emailed on submit");
  ok(!/Surdegsbr|Familjer|Varm och rak/.test(notice), "notice email holds no client content");
  r = await call("/intake/submit", { method: "POST", cookie: A.cookie, body: {} });
  ok(r.data.intakeVersion === 2, "a new submit creates version 2");
  r = await call("/status", { cookie: A.cookie });
  const sts = r.data.history.map((x) => x.status).join(",");
  ok(r.data.status === "submitted" && sts === "invited,profile_in_progress,submitted,submitted" && r.data.latestIntakeVersion === 2, "status and history are right (" + sts + ")");
  ok(r.data.history.every((x) => x.label.sv && x.label.en && x.at), "every status change has a timestamp and both languages");

  r = await call("/admin/clients", { cookie: admin });
  const ca = r.data.clients.find((c) => c.id === A.id);
  ok(ca && ca.latestIntakeVersion === 2 && ca.hasNewIntake === true && ca.status === "submitted", "admin list shows version 2 and the New flag");
  r = await call("/admin/intake/" + A.id, { cookie: admin });
  ok(r.status === 200 && r.data.version === 2 && r.data.intake.profile.location === "Örebro" && r.data.files.length >= 2 && r.data.files[0].url.startsWith("/api/vault/files/"), "admin can read the latest intake and its files");
  r = await call("/admin/intake/" + A.id, { cookie: B.cookie });
  ok(r.status === 403, "a client cannot read another client's intake through the admin endpoint");
  r = await call("/intake", { cookie: admin });
  ok(r.status === 403, "admin cannot use client endpoints");
  r = await call("/intake", {});
  ok(r.status === 401, "anonymous cannot read an intake");
  r = await call("/portal/state", { cookie: B.cookie });
  ok(r.data.draft.profile.companyName === "" && r.data.files.length === 0, "client B sees only its own empty record");

  r = await call("/files/" + picId, { method: "DELETE", cookie: A.cookie });
  ok(r.status === 200, "client can delete its own file");
  r = await call("/me/language", { method: "PUT", cookie: A.cookie, body: { language: "en" } });
  r = await call("/portal/state", { cookie: A.cookie });
  ok(r.data.client.language === "en", "language choice is remembered per client");
} catch (e) {
  fail++;
  console.log("FAIL exception " + e.stack);
}
console.log("\n" + pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
