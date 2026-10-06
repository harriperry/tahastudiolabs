/* V2 Parts A and B test: client review and approval in the portal, Mark delivered rules, the
   delivery library (Your content) with signed file links, and large files sent in parts.
   Same local setup as pages.test.mjs (started by test/run-all.mjs). */
import fs from "node:fs";
import { execFileSync } from "node:child_process";

const BASE = process.env.VAULT_URL || "http://127.0.0.1:8080/api/vault";
const ORIGIN = process.env.ORIGIN || "http://localhost:8080";
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
  const buf = Buffer.from(await r.arrayBuffer());
  let data = null;
  try { data = JSON.parse(buf.toString("utf8")); } catch (e) {}
  return { status: r.status, data, buf, headers: r.headers };
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
/* A tiny MP4-shaped file: size box then "ftyp". */
const MP4 = Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from("ftypisom"), Buffer.alloc(9 * 1024 * 1024, 7)]);

async function newClient(name) {
  const email = "ab-" + name.toLowerCase().replace(/[^a-z]+/g, "-") + "-" + run + "@example.com";
  const mark = logSize();
  let r = await call("/admin/clients", { method: "POST", cookie: ADMIN, body: { name, email, language: "en" } });
  const id = r.data.client.id;
  r = await call("/auth/verify", { method: "POST", body: { t: await linkFor(email, mark) } });
  const cookie = (r.headers.getSetCookie().find((x) => x.startsWith("__Host-tv_session=")) || "").split(";")[0];
  await call("/consent", { method: "POST", cookie, body: { accepted: true, language: "en" } });
  return { id, email, cookie };
}

try {
  const A = await newClient("Review Kitchen");
  const B = await newClient("Other Shop");
  let r = await call("/uploads?section=pictures", { method: "POST", cookie: A.cookie, raw: PNG, headers: { "Content-Type": "image/png", "X-File-Name": "photo.png" } });
  const fixture = read("./fixtures/pilot-intake-v1.json");
  await call("/intake", { method: "PUT", cookie: A.cookie, body: { answerLanguage: "en", campaignLanguage: "en", profile: fixture.profile, uploads: { pictures: [{ fileId: r.data.file.id, name: "photo.png", mime: "image/png" }], founderStory: { text: "Story.", fileId: null }, previousPosts: [], faqs: { rows: [], fileId: null } } } });
  await call("/intake/submit", { method: "POST", cookie: A.cookie, body: {} });
  const brain = Object.assign(read("./fixtures/pilot-brain-v1.json"), { builtFromIntakeVersion: 1, editedByHarry: false });
  await call("/admin/brain/" + A.id, { method: "POST", cookie: ADMIN, body: { brain } });
  const m = read("./fixtures/pilot-campaign-model.json");
  m.socialCopy = m.socialCopy.map((p) => (p.channel === "google_business" ? Object.assign(p, { hashtags: [] }) : p));
  const doc = Object.assign({ schemaVersion: "campaign-1", clientId: A.id, campaignId: "cp_2026_10_en", brainVersion: 1, name: "A Little Extra", month: "2026-10", goal: "sales", language: "en", channels: ["instagram", "facebook", "google_business"], status: "in_production" }, m);
  r = await call("/admin/campaign/" + A.id, { method: "POST", cookie: ADMIN, body: { campaign: doc } });
  ok(r.status === 201, "a saved campaign to review");
  /* A page with links, so the client's copy texts carry a short link and offer code. */
  await call("/admin/page/" + A.id + "/cp_2026_10_en", { method: "PUT", cookie: ADMIN, body: { clientSlug: "review-kitchen", slug: "extra", offerEnd: "2099-12-31", settings: { phone: "+46701234567" }, links: [{ outputKey: "post.instagram", channel: "instagram", medium: "social", label: "Instagram post", offerCode: "REVIEW-IG" }, { outputKey: "share.main", channel: "share", medium: "share", label: "Short link", offerCode: "REVIEW-WEB" }] } });
  /* Published (as the Publish button would do): links only go to the client for a live page. */
  r = await call("/portal/campaign/cp_2026_10_en", { cookie: A.cookie });
  sql("UPDATE pages SET state = 'published', version = 1 WHERE client_slug = 'review-kitchen'");
  const R = "/admin/campaign/" + A.id + "/cp_2026_10_en/review";

  /* ---------- Part A ---------- */
  r = await call("/portal/campaigns", { cookie: A.cookie });
  ok(r.status === 200 && r.data.campaigns.length === 0, "nothing shows in the portal before Harry sends it");
  r = await call(R, { method: "POST", cookie: A.cookie, body: {} });
  ok(r.status === 403, "a client cannot send a campaign for review");
  let mark = logSize();
  r = await call(R, { method: "POST", cookie: ADMIN, body: {} });
  ok(r.status === 201 && r.data.rounds.length === 1 && r.data.rounds[0].round === 1 && r.data.rounds[0].state === "waiting", "Send to client for review makes round 1, Waiting for client");
  const mail = await mailAfter(new RegExp("\\[dev mail\\] to=" + A.email.replace(/[.+]/g, "\\$&") + " subject=Your campaign is ready for you to review"), mark);
  ok(!!mail && /#campaign-cp_2026_10_en/.test(mail) && !/Refer ten friends|Comfort on your plate/.test(mail), "she gets an email with a portal link and no campaign content");
  r = await call("/portal/campaigns", { cookie: A.cookie });
  ok(r.data.campaigns.length === 1 && r.data.campaigns[0].reviewState === "waiting" && r.data.campaigns[0].name === "A Little Extra", "the portal shows Waiting for your approval");
  r = await call("/portal/campaign/cp_2026_10_en", { cookie: A.cookie });
  const cards = r.data.review.view.cards;
  const keys = cards.map((c) => c.key);
  ok(r.status === 200 && keys.includes("concept") && keys.includes("offer") && keys.includes("shortVideo") && keys.includes("socialCopy.instagram") && keys.includes("adVariations.5") && keys.includes("landingPage") && keys.includes("email") && keys.includes("googleBusinessPost"), "she sees every output as a card: idea, offer, video, posts, ads, page, email, Google Business");
  const raw = JSON.stringify(r.data);
  ok(!/"(visuals|prompt|brainVersion|brain|overlay|clear_zone|alt_text|personas|schemaVersion)"/.test(raw) && !/\bAI\b|Business Brain|image prompt/i.test(raw), "no brain, prompts, image briefs or AI wording reach the client");
  const ig = cards.find((c) => c.key === "socialCopy.instagram");
  ok(ig.offerCode === "REVIEW-IG" && /\/go\/r\/[a-z0-9]{7}$/.test(ig.copyText) && /REVIEW-IG/.test(ig.copyText), "a post's copy text carries its offer code and tracked short link");
  ok(!/\u2014/.test(raw), "no em-dashes in what the client sees");
  r = await call("/portal/campaign/cp_2026_10_en", { cookie: B.cookie });
  ok(r.status === 404, "another client never sees it");
  r = await call("/portal/review/cp_2026_10_en", { method: "POST", cookie: B.cookie, body: { items: [], approve: true } });
  ok(r.status === 404, "another client cannot answer it");
  r = await call("/portal/review/cp_2026_10_en", { method: "POST", cookie: A.cookie, body: { items: [{ key: "offer", verdict: "change", comment: "" }], send: true } });
  ok(r.status === 400 && r.data.error === "comment", "Change this needs a comment");
  r = await call("/portal/review/cp_2026_10_en", { method: "POST", cookie: A.cookie, body: { items: [{ key: "nothing", verdict: "ok" }] } });
  ok(r.status === 400, "an unknown card is refused");
  r = await call("/portal/review/cp_2026_10_en", { method: "POST", cookie: A.cookie, body: { items: [{ key: "concept", verdict: "ok" }, { key: "offer", verdict: "change", comment: "Make it 8 friends, not 10." }], approve: true } });
  ok(r.status === 409 && r.data.error === "open", "Approve the whole campaign is blocked while a card asks for a change");
  mark = logSize();
  r = await call("/portal/review/cp_2026_10_en", { method: "POST", cookie: A.cookie, body: { items: [{ key: "concept", verdict: "ok" }, { key: "offer", verdict: "change", comment: "Make it 8 friends, not 10." }], send: true } });
  ok(r.status === 200 && r.data.state === "changes" && r.data.changes === 1, "she sends her changes");
  const notice = await mailAfter(/\[dev mail\] to=agborkak@gmail\.com subject=Ändringar \/ Changes requested: Review Kitchen \(1\)/, mark);
  ok(!!notice && !/8 friends/.test(notice), "Harry gets an email with company and round only");
  r = await call(R, { cookie: ADMIN });
  ok(r.data.rounds[0].state === "changes" && r.data.rounds[0].items.find((i) => i.key === "offer").comment === "Make it 8 friends, not 10.", "Harry sees every verdict and comment in the panel");
  r = await call("/portal/review/cp_2026_10_en", { method: "POST", cookie: A.cookie, body: { items: [], approve: true } });
  ok(r.status === 409 && r.data.error === "closed", "an answered round cannot be answered again");
  r = await call("/admin/campaign/" + A.id + "/cp_2026_10_en/status", { method: "PATCH", cookie: ADMIN, body: { status: "delivered" } });
  ok(r.status === 409 && r.data.error === "not_approved" && r.data.reviewState === "changes", "Mark delivered is blocked until she approves");
  r = await call("/admin/campaign/" + A.id + "/cp_2026_10_en/status", { method: "PATCH", cookie: ADMIN, body: { status: "delivered", override: "ok" } });
  ok(r.status === 409, "an override needs a real reason");
  r = await call(R, { method: "POST", cookie: ADMIN, body: {} });
  ok(r.status === 201 && r.data.rounds[0].round === 2 && r.data.rounds[0].state === "waiting" && r.data.rounds[1].state === "changes", "round 2 goes out; round 1 stays readable");
  await call(R, { method: "POST", cookie: ADMIN, body: {} });
  r = await call(R, { cookie: ADMIN });
  ok(r.data.rounds[0].round === 3 && r.data.rounds[1].state === "withdrawn", "an unanswered round is replaced by the newer one");
  mark = logSize();
  const all = (await call("/portal/campaign/cp_2026_10_en", { cookie: A.cookie })).data.review.view.cards.map((c) => ({ key: c.key, verdict: "ok" }));
  r = await call("/portal/review/cp_2026_10_en", { method: "POST", cookie: A.cookie, body: { items: all, approve: true } });
  ok(r.status === 200 && r.data.state === "approved", "she approves the whole campaign");
  ok(!!(await mailAfter(/\[dev mail\] to=agborkak@gmail\.com subject=Godkänd \/ Approved: Review Kitchen \(3\)/, mark)), "Harry hears it was approved");
  r = await call("/portal/campaigns", { cookie: A.cookie });
  ok(r.data.campaigns[0].reviewState === "approved" && !r.data.campaigns[0].delivered, "the portal shows Campaign approved");

  /* ---------- Part B: files ---------- */
  const U = "/admin/upload/" + A.id + "/cp_2026_10_en";
  r = await call(U + "/start", { method: "POST", cookie: ADMIN, body: { name: "film.avi", size: 1000 } });
  ok(r.status === 415, "only MP4, MOV, PDF and images are taken");
  r = await call(U + "/start", { method: "POST", cookie: ADMIN, body: { name: "film.mp4", size: 600 * 1024 * 1024 } });
  ok(r.status === 413, "a file over 500 MB is refused before upload");
  r = await call(U + "/start", { method: "POST", cookie: A.cookie, body: { name: "film.mp4", size: 1000 } });
  ok(r.status === 403, "a client cannot upload delivery files");
  r = await call(U + "/start", { method: "POST", cookie: ADMIN, body: { name: "fake.mp4", size: 3000 } });
  let bad = r.data.uploadId;
  r = await call(U + "/" + bad + "/part?n=1", { method: "PUT", cookie: ADMIN, raw: Buffer.from("not a video at all, just text"), headers: { "Content-Type": "application/octet-stream" } });
  ok(r.status === 415, "a file whose bytes are not a video is refused");
  await call(U + "/" + bad, { method: "DELETE", cookie: ADMIN });
  r = await call(U + "/start", { method: "POST", cookie: ADMIN, body: { name: "founder-video.mp4", size: MP4.length, title: "Founder video", ai: false } });
  ok(r.status === 201 && r.data.partBytes === 8 * 1024 * 1024 && r.data.parts === 2, "a 9 MB video goes up in 2 parts of 8 MB");
  const up = r.data.uploadId;
  const parts = [];
  for (let n = 1, off = 0; off < MP4.length; n++, off += r.data.partBytes) {
    const p = await call(U + "/" + up + "/part?n=" + n, { method: "PUT", cookie: ADMIN, raw: MP4.subarray(off, off + 8 * 1024 * 1024), headers: { "Content-Type": "application/octet-stream" } });
    parts.push({ partNumber: p.data.partNumber, etag: p.data.etag });
  }
  r = await call(U + "/" + up + "/complete", { method: "POST", cookie: ADMIN, body: { parts } });
  ok(r.status === 201 && r.data.delivery.kind === "video" && r.data.delivery.size === MP4.length && r.data.delivery.title === "Founder video", "the parts join into one video in the campaign's files");
  r = await call("/admin/delivery/" + A.id + "/cp_2026_10_en?visual=&ai=1&title=Offer%20image", { method: "POST", cookie: ADMIN, raw: PNG, headers: { "Content-Type": "image/png", "X-File-Name": "offer.png" } });
  ok(r.status === 201, "a finished image is attached too");

  /* ---------- Mark delivered and Your content ---------- */
  r = await call("/portal/campaign/cp_2026_10_en", { cookie: A.cookie });
  ok(r.data.content === null, "nothing to download before Mark delivered");
  mark = logSize();
  r = await call("/admin/campaign/" + A.id + "/cp_2026_10_en/status", { method: "PATCH", cookie: ADMIN, body: { status: "delivered" } });
  ok(r.status === 200 && r.data.clientStatus === "campaign_delivered", "after her approval Mark delivered works without a reason");
  const dmail = await mailAfter(new RegExp("\\[dev mail\\] to=" + A.email.replace(/[.+]/g, "\\$&") + " subject=Your campaign content is ready"), mark);
  ok(!!dmail && /#content-cp_2026_10_en/.test(dmail) && !/Refer ten/.test(dmail), "she is told her content is in the portal, with no content in the email");
  r = await call("/portal/campaign/cp_2026_10_en", { cookie: A.cookie });
  const content = r.data.content;
  ok(r.status === 200 && content && content.view.cards.length === cards.length && content.files.length === 2 && /\/go\/r\/[a-z0-9]{7}$/.test(content.shortUrl), "Your content: every text, both files and the page's short link");
  const vid = content.files.find((f) => f.kind === "video");
  ok(/^\/api\/vault\/dl\/d_[a-z0-9]+\?e=\d+&s=[0-9a-f]{32}$/.test(vid.url), "files come as signed links");
  r = await call("", { abs: ORIGIN.replace("localhost", "127.0.0.1") + vid.url, cookie: A.cookie });
  ok(r.status === 200 && r.buf.length === MP4.length && /attachment; filename="Founder video.mp4"/.test(r.headers.get("content-disposition")), "she downloads the video with its title as the file name");
  r = await call("", { abs: ORIGIN.replace("localhost", "127.0.0.1") + vid.url });
  ok(r.status === 401, "a signed link alone is not enough without her session");
  r = await call("", { abs: ORIGIN.replace("localhost", "127.0.0.1") + vid.url, cookie: B.cookie });
  ok(r.status === 404, "another client's session cannot use it");
  r = await call("", { abs: ORIGIN.replace("localhost", "127.0.0.1") + vid.url.replace(/s=[0-9a-f]{4}/, "s=0000"), cookie: A.cookie });
  ok(r.status === 404, "a changed signature is refused");
  const expired = vid.url.replace(/e=\d+/, "e=" + (Math.floor(Date.now() / 1000) - 5));
  r = await call("", { abs: ORIGIN.replace("localhost", "127.0.0.1") + expired, cookie: A.cookie });
  ok(r.status === 403 && r.data.error === "expired", "an expired link is refused (10 minutes)");
  r = await call("/portal/campaigns", { cookie: A.cookie });
  ok(r.data.campaigns[0].delivered, "the campaign is listed as delivered");

  /* A second campaign: delivered without approval needs and logs a reason */
  const doc2 = Object.assign({}, doc, { campaignId: "cp_2026_11_en", month: "2026-11", name: "November" });
  await call("/admin/campaign/" + A.id, { method: "POST", cookie: ADMIN, body: { campaign: doc2 } });
  r = await call("/admin/campaign/" + A.id + "/cp_2026_11_en/status", { method: "PATCH", cookie: ADMIN, body: { status: "delivered", override: "Approved by phone on 7 October" } });
  ok(r.status === 200, "Harry can deliver without portal approval when he gives a reason");
  r = await call("/admin/campaign/" + A.id + "/cp_2026_11_en/review", { cookie: ADMIN });
  ok(r.data.log.some((l) => l.event === "delivered_without_approval" && l.detail === "Approved by phone on 7 October"), "the reason is logged");
  r = await call("/portal/campaigns", { cookie: A.cookie });
  ok(r.data.campaigns.length === 2 && r.data.campaigns[0].campaignId === "cp_2026_11_en", "earlier months stay listed, newest first");

  /* Portal page and the ZIP library */
  r = await call("", { abs: ORIGIN.replace("localhost", "127.0.0.1") + "/grow/jszip.js" });
  ok(r.status === 200 && /JSZip/.test(r.buf.toString("utf8").slice(0, 2000)), "the portal serves its ZIP library itself (no third party)");

  /* ---------- export and erasure ---------- */
  r = await call("/admin/export/" + A.id, { cookie: ADMIN });
  ok(r.status === 200 && r.data.reviews.length >= 3 && r.data.reviewAnswers.some((x) => x.comment === "Make it 8 friends, not 10.") && r.data.campaignLog.length > 0 && r.data.deliveries.length === 2, "the export includes rounds, answers, the log and the delivered files");
  r = await call("/admin/clients/" + A.id, { method: "DELETE", cookie: ADMIN, body: { confirm: A.email } });
  ok(r.status === 200 && r.data.remaining.rows === 0 && r.data.remaining.files === 0, "erasure removes reviews, answers, the log, uploads and every file");
  ok(["reviews", "review_items", "campaign_log", "uploads", "deliveries"].every((t) => sql("SELECT COUNT(*) AS n FROM " + t + " WHERE client_id = '" + A.id + "'")[0].n === 0), "no rows left in the new tables");
} catch (e) {
  fail++;
  console.log("FAIL crashed: " + e.stack);
}
console.log("\n" + pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
