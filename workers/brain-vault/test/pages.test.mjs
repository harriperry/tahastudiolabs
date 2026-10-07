/* V2 phase G2b test: hosted landing pages, short links and QR codes, cookieless counting,
   enquiries, before and after numbers, costs, the Performance numbers, the portal's Your
   enquiries and Campaign report, lifecycle (ended, taken down, left) and erasure.
   Same local setup as photos.test.mjs (Vault behind the local site on port 8080, started by
   test/run-all.mjs). The page HTML is made with the real builder, assets/growth-landing.js. */
import fs from "node:fs";
import { execFileSync } from "node:child_process";
import { campaignText, linkPlan, pageModel, renderPage } from "../../../assets/growth-landing.js";

const BASE = process.env.VAULT_URL || "http://127.0.0.1:8080/api/vault";
const SITE = BASE.replace(/\/api\/vault$/, "");
const WORKER = "http://127.0.0.1:8787";
const ORIGIN = process.env.ORIGIN || "http://localhost:8080";
const DEV_LOG = process.env.DEV_LOG;
const UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1";
const run = Date.now().toString(36);
let pass = 0, fail = 0;
const ok = (c, n) => { if (c) { pass++; console.log("PASS " + n); } else { fail++; console.log("FAIL " + n); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function call(path, { method = "GET", body, raw, headers = {}, cookie, origin = ORIGIN, base = BASE } = {}) {
  const h = Object.assign({ Accept: "application/json", "User-Agent": UA }, headers);
  if (body !== undefined) h["Content-Type"] = "application/json";
  if (cookie) h.Cookie = cookie;
  if (origin && method !== "GET") h.Origin = origin;
  /* Retried only when the connection itself drops: the local server can restart for a moment
     right after the test writes to its database directly. App errors are never retried. */
  let r;
  for (let i = 0; ; i++) {
    try {
      r = await fetch(base + path, { method, headers: h, body: raw !== undefined ? raw : body === undefined ? undefined : JSON.stringify(body), redirect: "manual" });
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
/* The daily job, as wrangler dev --test-scheduled runs it. Retried: the local server can be
   briefly busy right after a direct database write. */
async function scheduled() {
  for (let i = 0; i < 8; i++) {
    try {
      const r = await fetch(WORKER + "/__scheduled?cron=17+3+*+*+*");
      if (r.ok) return;
    } catch (e) {}
    await sleep(1000);
  }
  throw new Error("the scheduled handler did not answer");
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
const template = fs.readFileSync(new URL("../../../assets/growth/landing.template.html", import.meta.url), "utf8");
const ADMIN = "sf_sid=admin";
const PNG = Buffer.from("89504e470d0a1a0a0000000d4948445200000001000000010806000000" + "1f15c4890000000d49444154789c6360000002000154a24f5d0000000049454e44ae426082", "hex");
const WEBP = Buffer.concat([Buffer.from("RIFF"), Buffer.from([30, 0, 0, 0]), Buffer.from("WEBPVP8L"), Buffer.from([17, 0, 0, 0, 0x2f, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0])]);

async function newClient(name) {
  const email = "lp-" + name.toLowerCase().replace(/[^a-z]+/g, "-") + "-" + run + "@example.com";
  const mark = logSize();
  let r = await call("/admin/clients", { method: "POST", cookie: ADMIN, body: { name, email, language: "en" } });
  const id = r.data.client.id;
  r = await call("/auth/verify", { method: "POST", body: { t: await linkFor(email, mark) } });
  const cookie = (r.headers.getSetCookie().find((x) => x.startsWith("__Host-tv_session=")) || "").split(";")[0];
  await call("/consent", { method: "POST", cookie, body: { accepted: true, language: "en" } });
  return { id, email, cookie };
}

async function newCampaign(client, campaignId, language) {
  const m = read("./fixtures/pilot-campaign-model.json");
  m.socialCopy = m.socialCopy.map((p) => (p.channel === "google_business" ? Object.assign(p, { hashtags: [] }) : p));
  const doc = Object.assign({ schemaVersion: "campaign-1", clientId: client.id, campaignId, brainVersion: 1, name: "A Little Extra", month: "2026-10", goal: "sales", language: language || "en", channels: ["instagram", "facebook", "tiktok", "google_business"], status: "in_production" }, m);
  const r = await call("/admin/campaign/" + client.id, { method: "POST", cookie: ADMIN, body: { campaign: doc } });
  return { status: r.status, doc: r.data && r.data.campaign };
}

function buildHtml(doc, page, links, ended) {
  const text = campaignText(doc);
  const m = pageModel({ doc, text, profile: { companyName: "Lamp Kitchen" }, kit: { colors: [{ role: "primary", hex: "#7A1F1F" }, { role: "accent", hex: "#F2B705" }] }, page, images: { hero: { src: "/go/a/" + page.id + "/hero-800.webp", srcset: [{ url: "/go/a/" + page.id + "/hero-800.webp", w: 800 }], width: 800, height: 450 } }, origin: SITE, mode: "hosted", links });
  return renderPage(template, m, { ended: !!ended });
}

const settings = { companyName: "Lamp Kitchen", phone: "+46701234567", whatsapp: "46701234567", address: "Storgatan 1, Örebro", hours: "Every day 8 to 22", primary: "whatsapp", reviews: ["Real review."], gallery: [] };

try {
  const A = await newClient("Lamp Kitchen");
  const B = await newClient("Other Barber");
  let r = await call("/uploads?section=pictures", { method: "POST", cookie: A.cookie, raw: PNG, headers: { "Content-Type": "image/png", "X-File-Name": "photo.png" } });
  const fixture = read("./fixtures/pilot-intake-v1.json");
  await call("/intake", { method: "PUT", cookie: A.cookie, body: { answerLanguage: "en", campaignLanguage: "en", profile: fixture.profile, uploads: { pictures: [{ fileId: r.data.file.id, name: "photo.png", mime: "image/png" }], founderStory: { text: "Story.", fileId: null }, previousPosts: [], faqs: { rows: [], fileId: null } } } });
  await call("/intake/submit", { method: "POST", cookie: A.cookie, body: {} });
  const brain = Object.assign(read("./fixtures/pilot-brain-v1.json"), { builtFromIntakeVersion: 1, editedByHarry: false });
  await call("/admin/brain/" + A.id, { method: "POST", cookie: ADMIN, body: { brain } });
  const c1 = await newCampaign(A, "cp_2026_10_en");
  ok(c1.status === 201, "a campaign to make a page for");
  const P = "/admin/page/" + A.id + "/cp_2026_10_en";

  /* ---------- admin: roles, slugs, save ---------- */
  r = await call(P, { cookie: A.cookie });
  ok(r.status === 403, "a client cannot read the page settings");
  r = await call(P, { cookie: ADMIN });
  ok(r.status === 200 && r.data.page === null && r.data.suggest.clientSlug === "lamp-kitchen" && r.data.suggest.slug === "a-little-extra", "no page yet; the address is suggested from the names");
  r = await call(P, { method: "PUT", cookie: ADMIN, body: { clientSlug: "Lamp Kitchen!", slug: "a-little-extra", settings } });
  ok(r.status === 400 && r.data.error === "slug", "an address with spaces or symbols is refused");
  r = await call(P, { method: "PUT", cookie: ADMIN, body: { clientSlug: "r", slug: "x", settings } });
  ok(r.status === 400, "reserved addresses are refused");
  const plan = linkPlan(c1.doc, "LAMP", settings);
  r = await call(P, { method: "PUT", cookie: ADMIN, body: { clientSlug: "lamp-kitchen", slug: "a-little-extra", language: "en", offerEnd: "", formOn: true, noticeApproved: false, settings: Object.assign({}, settings, { bookingUrl: "javascript:alert(1)", mapUrl: "http://insecure.example" }), links: plan } });
  ok(r.status === 200 && r.data.page.state === "draft" && r.data.page.url === "http://localhost:8080/go/lamp-kitchen/a-little-extra", "Save makes a draft at /go/lamp-kitchen/a-little-extra");
  ok(r.data.page.settings.bookingUrl === "" && r.data.page.settings.mapUrl === "", "only https links are kept for the buttons");
  ok(r.data.links.length === plan.length && r.data.links.every((l) => /^[a-z0-9]{7}$/.test(l.code)), "every output gets a tracked short link");
  const codes1 = Object.fromEntries(r.data.links.map((l) => [l.outputKey, l.code]));
  ok(r.data.links.find((l) => l.outputKey === "post.instagram").offerCode === "LAMP-IG", "offer codes are stored per link");
  let page = r.data.page;
  r = await call(P, { method: "PUT", cookie: ADMIN, body: { clientSlug: "lamp-kitchen", slug: "a-little-extra", language: "en", offerEnd: "2099-12-31", formOn: true, noticeApproved: false, settings, links: plan } });
  ok(r.data.links.every((l) => codes1[l.outputKey] === l.code), "saving again keeps every code");
  /* Client B gets a copy of the campaign row directly: only the address clash matters here. */
  sql("INSERT INTO campaigns (client_id, campaign_id, brain_version, month, status, data, created_at, updated_at) SELECT '" + B.id + "', campaign_id, brain_version, month, status, data, created_at, updated_at FROM campaigns WHERE client_id = '" + A.id + "' AND campaign_id = 'cp_2026_10_en'");
  const c2 = { status: 201 };
  r = await call("/admin/page/" + B.id + "/cp_2026_10_en", { method: "PUT", cookie: ADMIN, body: { clientSlug: "lamp-kitchen", slug: "other", settings } });
  ok(c2.status === 201 && r.status === 409 && r.data.error === "taken", "another client cannot use the same client address");

  /* ---------- assets and publish checks ---------- */
  r = await call(P + "/asset?name=hero-800.webp", { method: "POST", cookie: ADMIN, raw: PNG, headers: { "Content-Type": "image/webp" } });
  ok(r.status === 415, "an image whose bytes do not match its name is refused");
  r = await call(P + "/asset?name=../x.webp", { method: "POST", cookie: ADMIN, raw: WEBP, headers: { "Content-Type": "image/webp" } });
  ok(r.status === 400, "an asset name with a path is refused");
  r = await call(P + "/asset?name=hero-800.webp", { method: "POST", cookie: ADMIN, raw: WEBP, headers: { "Content-Type": "image/webp" } });
  ok(r.status === 201 && r.data.url === "/go/a/" + page.id + "/hero-800.webp", "a WebP image is stored for the page");
  r = await call(P + "/asset?name=og.jpg", { method: "POST", cookie: ADMIN, raw: Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1]), headers: { "Content-Type": "image/jpeg" } });
  ok(r.status === 201, "the link preview JPEG is stored");
  const r0 = await call(P, { cookie: ADMIN });
  const links = r0.data.links;
  page = r0.data.page;
  const good = buildHtml(c1.doc, page, links);
  r = await call(P + "/publish", { method: "POST", cookie: ADMIN, body: { html: good, endedHtml: buildHtml(c1.doc, page, links, true) } });
  ok(r.status === 400 && r.data.error === "notice", "with the form on, publishing waits for the client's approval of the privacy notice");
  await call(P, { method: "PUT", cookie: ADMIN, body: { clientSlug: "lamp-kitchen", slug: "a-little-extra", language: "en", offerEnd: "", formOn: true, noticeApproved: true, noticeVersion: "n-1", settings, links: plan } });
  r = await call(P + "/publish", { method: "POST", cookie: ADMIN, body: { html: good, endedHtml: good } });
  ok(r.status === 400 && r.data.error === "end", "publishing needs the offer's end date");
  await call(P, { method: "PUT", cookie: ADMIN, body: { clientSlug: "lamp-kitchen", slug: "a-little-extra", language: "en", offerEnd: "2099-12-31", formOn: true, noticeApproved: true, noticeVersion: "n-1", settings, links: plan } });
  for (const [bad, why] of [
    [good.replace("</body>", "<script>alert(1)</script></body>"), "a script"],
    [good.replace("</body>", '<img src="https://evil.example/p.gif"></body>'), "a third-party image"],
    [good.replace("</body>", '<link rel="stylesheet" href="https://fonts.googleapis.com/css"></body>'), "a web font"],
    [good.replace("</body>", '<a href="#" onclick="x()">x</a></body>'), "an event handler"],
    [good.replace("</body>", "<p>a \u2014 b</p></body>"), "an em-dash"]
  ]) {
    r = await call(P + "/publish", { method: "POST", cookie: ADMIN, body: { html: bad, endedHtml: good } });
    ok(r.status === 400, "a page with " + why + " is refused");
  }
  r = await call(P + "/publish", { method: "POST", cookie: ADMIN, body: { html: good.replace("</body>", "<p>Buy only = 2 plates</p></body>"), endedHtml: buildHtml(c1.doc, page, links, true) } });
  ok(r.status === 200 && r.data.page.state === "published" && r.data.page.version === 1, "the built page publishes (ordinary text like only = 2 is fine)");
  r = await call(P + "/publish", { method: "POST", cookie: ADMIN, body: { html: good, endedHtml: buildHtml(c1.doc, page, links, true) } });
  ok(r.status === 200 && r.data.page.version === 2 && r.data.page.url.endsWith("/go/lamp-kitchen/a-little-extra"), "an update keeps the same link (version 2)");
  ok(sql("SELECT COUNT(*) AS n FROM pages WHERE id = '" + page.id + "' AND html_key LIKE '%page-v2.html'")[0].n === 1, "the newest version is served");

  /* ---------- public page ---------- */
  r = await call("/go/lamp-kitchen/a-little-extra", { base: SITE });
  ok(r.status === 200 && /<h1>Comfort on your plate, a text away<\/h1>/.test(r.text), "the page is live at /go/<client>/<campaign>");
  ok(/<script src="\/go\/t.js" data-p="pg_[a-z0-9]+" defer><\/script><\/body>/.test(r.text), "the Worker adds the counting snippet");
  const csp = r.headers.get("content-security-policy") || "";
  ok(/default-src 'none'/.test(csp) && /script-src 'self'/.test(csp) && /frame-ancestors \*/.test(csp) && !r.headers.get("set-cookie"), "strict CSP, embeddable, and no cookie set");
  r = await call("/go/lamp-kitchen/a-little-extra", { base: SITE, cookie: ADMIN });
  ok(r.status === 200 && !/go\/t\.js/.test(r.text), "Harry's own signed-in visit gets the page without the counter");
  r = await call("/go/lamp-kitchen/a-little-extra/", { base: SITE });
  ok(r.status === 301 && /\/go\/lamp-kitchen\/a-little-extra$/.test(r.headers.get("location")), "a trailing slash redirects to the page");
  r = await call("/go/lamp-kitchen/nothing-here", { base: SITE });
  ok(r.status === 404, "an unknown page is 404");
  r = await call("/go/a/" + page.id + "/hero-800.webp", { base: SITE });
  ok(r.status === 200 && r.headers.get("content-type") === "image/webp" && /max-age=86400/.test(r.headers.get("cache-control")), "the page images are served and cached");
  r = await call("/go/t.js", { base: SITE });
  ok(r.status === 200 && /sendBeacon/.test(r.text) && !/cookie|localStorage|sessionStorage/i.test(r.text), "the counter uses no cookies and no storage");

  /* ---------- counting ---------- */
  const codeOf = (k) => links.find((l) => l.outputKey === k).code;
  const ev = (body, ua, extra) => call("/pub/event", Object.assign({ method: "POST", raw: JSON.stringify(body), headers: Object.assign({ "Content-Type": "text/plain", "User-Agent": ua || UA }, (extra && extra.headers) || {}), origin: (extra && extra.origin) || ORIGIN }, extra && extra.cookie ? { cookie: extra.cookie } : {}));
  r = await ev({ p: page.id, t: "view", c: codeOf("post.instagram"), u: { utm_source: "instagram" }, w: 390 }, UA + " v1");
  ok(r.status === 204 && r.headers.get("access-control-allow-origin") === "*", "a view is counted (204, open to downloaded copies)");
  await ev({ p: page.id, t: "view", c: codeOf("post.instagram"), u: { utm_source: "instagram" } }, UA + " v1");
  await ev({ p: page.id, t: "click", b: "whatsapp", c: codeOf("post.instagram") }, UA + " v1");
  await ev({ p: page.id, t: "view", c: codeOf("post.facebook") }, UA + " v2");
  await ev({ p: page.id, t: "click", b: "call", c: codeOf("post.facebook") }, UA + " v2");
  await ev({ p: page.id, t: "view", u: { utm_source: "tiktok" } }, UA + " v3");
  await ev({ p: page.id, t: "view" }, UA + " v4", { origin: "https://salongen.example" });
  await ev({ p: page.id, t: "view" }, "Mozilla/5.0 (compatible; Googlebot/2.1)");
  await ev({ p: page.id, t: "view" }, UA + " admin", { cookie: ADMIN });
  await ev({ p: "pg_nothere1", t: "view" }, UA);
  await ev({ p: page.id, t: "hack" }, UA);
  r = await call("/go/r/" + codeOf("qr.flyer"), { base: SITE, headers: { "User-Agent": UA + " v5" } });
  const loc = r.headers.get("location") || "";
  ok(r.status === 302 && loc.startsWith(ORIGIN + "/go/lamp-kitchen/a-little-extra?") && /utm_source=print/.test(loc) && /utm_medium=print/.test(loc) && /utm_content=qr.flyer/.test(loc) && /c=[a-z0-9]{7}/.test(loc), "a QR code redirects to the page with its UTM fields and code");
  r = await call("/go/r/" + codeOf("button.whatsapp"), { base: SITE, headers: { "User-Agent": UA + " v6" } });
  ok(r.status === 302 && r.headers.get("location") === "https://wa.me/46701234567", "a downloaded page's WhatsApp button goes through its short link to WhatsApp");
  r = await call("/go/r/zzzzzzz", { base: SITE });
  ok(r.status === 404, "an unknown short link is 404");
  await sleep(500);
  const rows = sql("SELECT channel, type, n FROM daily_stats WHERE page_id = '" + page.id + "'");
  const n = (ch, t) => (rows.find((x) => x.channel === ch && x.type === t) || { n: 0 }).n;
  ok(n("instagram", "view") === 2 && n("instagram", "unique") === 1 && n("instagram", "click_whatsapp") === 1, "Instagram: 2 views, 1 visitor, 1 WhatsApp click");
  ok(n("facebook", "view") === 1 && n("facebook", "click_call") === 1 && n("tiktok", "view") === 1, "Facebook and TikTok are counted on their own channels");
  ok(n("print", "scan") === 1 && n("download", "click_whatsapp") === 1, "the QR scan and the download button click are counted");
  ok(n("direct", "view") === 1, "a view without a source counts as direct; bots, Harry, unknown pages and unknown types are not counted");
  const evs = sql("SELECT * FROM events WHERE page_id = '" + page.id + "'");
  ok(evs.length > 0 && evs.every((e) => /^[0-9a-f]{32}$/.test(e.visitor)) && !JSON.stringify(evs).includes("127.0.0.1"), "events hold a hashed visitor id and no IP address");
  ok(evs.some((e) => e.device === "phone"), "device class is stored (phone or desktop)");

  /* ---------- enquiries ---------- */
  const form = (fields, opts = {}) => call("/pub/lead/" + page.id, Object.assign({ method: "POST", raw: new URLSearchParams(fields).toString(), headers: Object.assign({ "Content-Type": "application/x-www-form-urlencoded", Accept: "text/html" }, opts.headers || {}), origin: opts.origin || ORIGIN }));
  r = await form({ name: "Bot", phone: "0701234567", website: "http://spam.example" });
  ok(r.status === 400, "a honeypot send is refused");
  r = await form({ name: "Far Away", phone: "0701234567" }, { origin: "https://salongen.example" });
  ok(r.status === 403, "an enquiry from another site without the page token is refused");
  let mark = logSize();
  r = await form({ name: "Anna Andersson", phone: "070 123 45 67", message: "Do you deliver to Rynninge?", offers: "1", c: codeOf("post.instagram") });
  ok(r.status === 303 && r.headers.get("location").endsWith("/go/lamp-kitchen/a-little-extra#sent"), "a form send from the page returns to the page's thank-you message");
  const toClient = await mailAfter(new RegExp("\\[dev mail\\] to=" + A.email.replace(/[.+]/g, "\\$&") + " subject=(New enquiry from your campaign page|Ny förfrågan)"), mark);
  ok(!!toClient && /#enquiries/.test(toClient) && !/Anna|Rynninge|070 123/.test(toClient), "the client gets an email with a portal link and no enquiry content");
  const toHarry = await mailAfter(/\[dev mail\] to=agborkak@gmail\.com subject=Ny förfrågan \/ New enquiry: Lamp Kitchen/, mark);
  ok(!!toHarry && !/Anna|Rynninge/.test(toHarry), "Harry gets a notice with the company name only");
  r = await form({ name: "Bo Berg", email: "bo@example.com", token: page.token }, { origin: "https://salongen.example", headers: { Accept: "application/json" } });
  ok(r.status === 200 && r.data.ok, "a downloaded copy with the page token can send an enquiry");
  r = await call("/pub/lead/" + page.id, { method: "POST", body: { name: "", phone: "" } });
  ok(r.status === 400 && r.data.error === "missing", "name and phone or email are required");
  r = await call("/pub/lead/" + page.id, { method: "POST", body: { name: "Cecilia", email: "c@example.com" } });
  ok(r.status === 200, "a JSON enquiry works too");
  r = await call("/pub/lead/" + page.id, { method: "POST", body: { name: "Dan", email: "d@example.com" } });
  ok(r.status === 200, "the fifth send in an hour is accepted");
  r = await call("/pub/lead/" + page.id, { method: "POST", body: { name: "Eva", email: "e@example.com" } });
  ok(r.status === 429, "a sixth send from the same address in one hour is refused");
  r = await call("/portal/leads", { cookie: A.cookie });
  const anna = r.data.leads.find((l) => l.name === "Anna Andersson");
  ok(r.status === 200 && r.data.leads.length === 4 && anna && anna.channel === "instagram" && anna.futureOffers && anna.message === "Do you deliver to Rynninge?" && anna.campaignName === "A Little Extra", "the client sees her enquiries with channel, campaign and the offers choice");
  ok(r.data.leads.find((l) => l.name === "Bo Berg").channel === "download", "an enquiry from her own website is marked as such");
  r = await call("/portal/leads", { cookie: B.cookie });
  ok(r.status === 200 && r.data.leads.length === 0, "another client never sees them");
  r = await call("/portal/leads/" + anna.id, { method: "PATCH", cookie: B.cookie, body: { state: "contacted" } });
  ok(r.status === 404, "another client cannot change them");
  r = await call("/portal/leads/" + anna.id, { method: "PATCH", cookie: A.cookie, body: { state: "contacted" } });
  ok(r.status === 200 && r.data.state === "contacted", "she marks one as contacted");
  r = await call("/portal/leads.csv", { cookie: A.cookie });
  ok(r.status === 200 && /text\/csv/.test(r.headers.get("content-type")) && /Anna Andersson/.test(r.text) && /kontaktad \/ contacted/.test(r.text), "CSV export works");
  const cec = (await call("/portal/leads", { cookie: A.cookie })).data.leads.find((l) => l.name === "Cecilia");
  r = await call("/portal/leads/" + cec.id, { method: "DELETE", cookie: A.cookie });
  ok(r.status === 200 && (await call("/portal/leads", { cookie: A.cookie })).data.leads.length === 3, "she deletes one");
  r = await call("/admin/leads/" + A.id + "/cp_2026_10_en", { cookie: ADMIN });
  ok(r.status === 200 && r.data.leads.length === 3, "Harry sees them in the panel");
  r = await call("/portal/leads", { cookie: ADMIN });
  ok(r.status === 403, "the portal list is for clients only");

  /* ---------- before, after, costs, Performance ---------- */
  r = await call("/admin/baseline/" + A.id + "/cp_2026_10_en", { method: "PUT", cookie: ADMIN, body: { before: { orders: 100, new_customers: 10, followers_instagram: 500 }, after: { orders: 130, new_customers: 20, "redemptions-LAMP-IG": 12, "redemptions-LAMP-FB": 3 } } });
  ok(r.status === 200 && r.data.before.orders === 100 && r.data.after["redemptions-LAMP-IG"] === 12, "before and after numbers are saved");
  r = await call("/admin/baseline/" + A.id + "/cp_2026_10_en", { method: "PUT", cookie: ADMIN, body: { before: { "bad key": 1 } } });
  ok(r.status === 400, "an unknown metric name is refused");
  r = await call("/admin/costs/" + A.id + "/cp_2026_10_en", { method: "PUT", cookie: ADMIN, body: { currency: "SEK", fee: 3000, adSpend: { instagram: 600, facebook: 400 }, avgOrderValue: 150, baselinePeriod: "September 2026" } });
  ok(r.status === 200 && r.data.fee === 3000 && r.data.adSpend.instagram === 600, "costs are saved");
  r = await call("/admin/stats/" + A.id + "/cp_2026_10_en", { cookie: ADMIN });
  const roi = r.data.roi;
  ok(r.status === 200 && roi.spend === 4000 && roi.totals.enquiries === 4, "spend is fee plus ad spend; every form send counts as an enquiry");
  ok(roi.change.orders === 0.3 && roi.change.new_customers === 1, "change against before: (after minus before) divided by before");
  ok(roi.costPerEnquiry === 1000 && roi.costPerNewCustomer === 200 && roi.estimatedReturn === 0.75, "cost per enquiry, cost per new customer and estimated return follow the spec formulas");
  const ig = roi.channels.find((c) => c.channel === "instagram");
  ok(ig.newCustomers === 12 && roi.bestChannel.channel === "instagram" && roi.bestChannel.basis === "new_customers", "best channel is the lowest cost per new customer, from offer code redemptions");
  ok(roi.channels.filter((c) => c.views > 0).length >= 3, "the Performance tab shows visits from at least three channels");
  r = await call("/admin/stats/" + A.id + "/cp_2026_10_en", { cookie: A.cookie });
  ok(r.status === 403, "a client cannot read the Performance numbers");

  /* ---------- portal: pages and report ---------- */
  r = await call("/portal/pages", { cookie: A.cookie });
  ok(r.status === 200 && r.data.pages.length === 1 && r.data.pages[0].url.endsWith("/go/lamp-kitchen/a-little-extra") && r.data.pages[0].campaignName === "A Little Extra", "the client sees her published page");
  r = await call("/portal/report/cp_2026_10_en", { cookie: A.cookie });
  ok(r.status === 200 && r.data.visits >= 5 && r.data.enquiries === 4 && r.data.bestChannel === "instagram" && r.data.change.orders === 0.3 && r.data.baselinePeriod === "September 2026", "the Campaign report shows visits, enquiries, best channel and before and after");
  ok(!("spend" in r.data) && !JSON.stringify(r.data).includes("3000"), "the report has no costs in it");
  r = await call("/portal/report/cp_2026_10_en", { cookie: B.cookie });
  ok(r.status === 404, "another client cannot read it");

  /* ---------- lifecycle ---------- */
  sql("UPDATE pages SET offer_end = '2020-01-01' WHERE id = '" + page.id + "'");
  r = await call("/go/lamp-kitchen/a-little-extra", { base: SITE });
  ok(r.status === 200 && /This offer has ended/.test(r.text) && /noindex/.test(r.headers.get("x-robots-tag") || ""), "after the end date the page shows the ended message");
  sql("UPDATE pages SET offer_end = date('now', '-31 days') WHERE id = '" + page.id + "'");
  await scheduled();
  await sleep(1500);
  r = await call("/go/lamp-kitchen/a-little-extra", { base: SITE });
  ok(r.status === 410, "30 days after the offer ends the daily job takes the page down (410)");
  ok(sql("SELECT COUNT(*) AS n FROM leads WHERE page_id = '" + page.id + "'")[0].n === 3, "enquiries stay until 90 days after the end");
  sql("UPDATE pages SET offer_end = date('now', '-91 days') WHERE id = '" + page.id + "'");
  sql("UPDATE events SET day = date('now', '-91 days') WHERE page_id = '" + page.id + "' AND type = 'view' AND channel = 'direct'");
  await scheduled();
  await sleep(1500);
  ok(sql("SELECT COUNT(*) AS n FROM leads WHERE page_id = '" + page.id + "'")[0].n === 0, "enquiries are deleted 90 days after the offer ends");
  ok(sql("SELECT COUNT(*) AS n FROM events WHERE page_id = '" + page.id + "' AND channel = 'direct'")[0].n === 0 && sql("SELECT COUNT(*) AS n FROM daily_stats WHERE page_id = '" + page.id + "'")[0].n > 0, "raw events go after 90 days; daily totals stay");
  ok(sql("SELECT COUNT(*) AS n FROM salts WHERE day < date('now')")[0].n === 0, "old daily salts are deleted");
  sql("UPDATE pages SET offer_end = '2099-12-31' WHERE id = '" + page.id + "'");
  r = await call(P + "/publish", { method: "POST", cookie: ADMIN, body: { html: good, endedHtml: good } });
  ok(r.status === 200 && (await call("/go/lamp-kitchen/a-little-extra", { base: SITE })).status === 200, "publishing again brings it back");
  r = await call(P + "/unpublish", { method: "POST", cookie: ADMIN, body: {} });
  ok(r.status === 200 && (await call("/go/lamp-kitchen/a-little-extra", { base: SITE })).status === 410, "Take down answers 410 Gone");
  await call(P + "/publish", { method: "POST", cookie: ADMIN, body: { html: good, endedHtml: good } });
  /* A second page for the same client, then Mark as left takes both down at once. */
  const c3 = await newCampaign(A, "cp_2026_11_en");
  await call("/admin/page/" + A.id + "/cp_2026_11_en", { method: "PUT", cookie: ADMIN, body: { clientSlug: "lamp-kitchen", slug: "november", offerEnd: "2099-12-31", settings, links: [] } });
  r = await call("/admin/page/" + A.id + "/cp_2026_11_en/publish", { method: "POST", cookie: ADMIN, body: { html: good, endedHtml: good } });
  ok(c3.status === 201 && r.status === 200 && (await call("/go/lamp-kitchen/november", { base: SITE })).status === 200, "a second page for the same client");
  r = await call("/admin/clients/" + A.id + "/left", { method: "POST", cookie: ADMIN, body: { left: true } });
  const g1 = await call("/go/lamp-kitchen/a-little-extra", { base: SITE });
  const g2 = await call("/go/lamp-kitchen/november", { base: SITE });
  const g3 = await call("/go/r/" + codeOf("qr.flyer"), { base: SITE });
  const g4 = await call("/go/a/" + page.id + "/hero-800.webp", { base: SITE });
  ok(g1.status === 410 && g2.status === 410 && g3.status === 410 && g4.status === 410, "Mark as left returns 410 on every page, short link and image of that client at once");
  r = await call("/admin/page/" + A.id + "/cp_2026_11_en/publish", { method: "POST", cookie: ADMIN, body: { html: good, endedHtml: good } });
  ok(r.status === 409 && r.data.error === "left", "a client who left cannot get a page published");
  r = await call("/pub/lead/" + page.id, { method: "POST", body: { name: "Late", email: "l@example.com" } });
  ok(r.status === 403, "the form of a client who left takes no enquiries");

  /* ---------- export and erasure ---------- */
  r = await call("/admin/export/" + A.id, { cookie: ADMIN });
  ok(r.status === 200 && r.data.landingPages.length === 2 && r.data.trackedLinks.length > 10 && Array.isArray(r.data.enquiries) && r.data.pageDailyTotals.length > 0 && r.data.results.some((x) => x.costs.fee === 3000) && !r.data.landingPages[0].token, "the export includes pages, links, enquiries, daily totals, before and after and costs (no form token)");
  r = await call("/admin/clients/" + A.id, { method: "DELETE", cookie: ADMIN, body: { confirm: A.email } });
  ok(r.status === 200 && r.data.remaining.rows === 0 && r.data.remaining.files === 0, "erasure leaves nothing (full scan finds no rows or files)");
  const left = ["pages", "links", "events", "daily_stats", "leads", "baselines", "costs"].map((t) => sql("SELECT COUNT(*) AS n FROM " + t + " WHERE client_id = '" + A.id + "'")[0].n);
  ok(left.every((x) => x === 0), "erasure removes pages, links, events, totals, enquiries, before and after and costs");
  ok((await call("/go/lamp-kitchen/a-little-extra", { base: SITE })).status === 404, "an erased client's page is gone");

  /* Health */
  r = await call("/health");
  ok(r.status === 200 && /^[a-z0-9]+$/.test(r.data.part), "health reports the current part");
} catch (e) {
  fail++;
  console.log("FAIL crashed: " + e.stack);
}
console.log("\n" + pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
