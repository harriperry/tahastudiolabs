/* V2 Part H test: the language reviewer role, language items and their versions, the checks
   before Done, Harry's decisions, the production gate, outdated texts, export and erasure.
   Same local setup as review.test.mjs (started by test/run-all.mjs). */
import fs from "node:fs";
import { execFileSync } from "node:child_process";
import { applyApproved, checkReviewed, langFields, lockedChips, wordDiff } from "../../../assets/growth-langfields.js";

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

async function newClient(name, language) {
  const email = "lh-" + name.toLowerCase().replace(/[^a-z]+/g, "-") + "-" + run + "@example.com";
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
  const brain = Object.assign(read("./fixtures/pilot-brain-v1.json"), { builtFromIntakeVersion: 1, editedByHarry: false });
  brain.words = { use: ["Komfort på tallriken"], avoid: ["billigt"] };
  await call("/admin/brain/" + id, { method: "POST", cookie: ADMIN, body: { brain } });
  return { id, email, cookie };
}
function campaign(clientId, language, extra) {
  const m = read("./fixtures/pilot-campaign-model.json");
  m.socialCopy = m.socialCopy.map((p) => (p.channel === "google_business" ? Object.assign(p, { hashtags: [] }) : p));
  return Object.assign({ schemaVersion: "campaign-1", clientId, campaignId: "cp_2026_11_sv", brainVersion: 1, name: "Lite extra", month: "2026-11", goal: "sales", language, channels: ["instagram", "facebook", "google_business"], status: "in_production" }, m, extra || {});
}

try {
  /* ---------- shared helpers ---------- */
  const doc0 = campaign("cl_x", "sv");
  const fields = langFields(doc0);
  ok(fields.some((f) => f.path === "landingPage.headline") && fields.some((f) => f.path === "socialCopy.instagram.text" && f.maxLen === 2200) && fields.some((f) => f.path === "adVariations.4.description") && fields.some((f) => f.path === "email.subjects.1"), "every Swedish text field is a language item, with platform limits");
  const patched = applyApproved(doc0, { "landingPage.headline": "Godkänd rubrik", "socialCopy.instagram.text": "Godkänt inlägg", "nope.path": "x" });
  ok(patched.landingPage.headline === "Godkänd rubrik" && patched.socialCopy.find((p) => p.channel === "instagram").text === "Godkänt inlägg" && doc0.landingPage.headline !== "Godkänd rubrik", "approved text replaces the machine text in a copy; the original stays");
  ok(lockedChips("Ring oss! Kod SANDY-IG https://tahastudiolabs.com/go/r/abc1234 {{NAME}}").length === 3, "links, offer codes and placeholders are locked");
  ok(checkReviewed("ok", "Kod SANDY-IG", {}).some((p) => p.code === "chip") && checkReviewed("a \u2014 b", "x", {}).some((p) => p.code === "dash") && checkReviewed("billigt", "x", { avoid: ["billigt"] }).some((p) => p.code === "avoid") && checkReviewed("x".repeat(11), "x", { maxLen: 10 }).some((p) => p.code === "length") && checkReviewed("Kod SANDY-IG nu", "Kod SANDY-IG", { maxLen: 100 }).length === 0, "the checks before Done: limit, em-dash, words to avoid, locked parts");
  ok(wordDiff("Hej alla vänner", "Hej alla kunder").some((d) => d.op === "del" && d.text.includes("vänner")) && wordDiff("a b", "a b").every((d) => d.op === "same"), "word by word difference for the side-by-side view");

  /* ---------- team ---------- */
  const A = await newClient("Svensk Salong", "sv");
  const B = await newClient("Annan Frisör", "sv");
  const RE = "reviewer-" + run + "@example.com";
  let r = await call("/admin/team/invite", { method: "POST", cookie: A.cookie, body: { name: "Erik", email: RE } });
  ok(r.status === 403, "a client cannot invite team members");
  r = await call("/admin/team/invite", { method: "POST", cookie: ADMIN, body: { name: "Erik", email: A.email } });
  ok(r.status === 409, "a client's email cannot be a team member");
  let mark = logSize();
  r = await call("/admin/team/invite", { method: "POST", cookie: ADMIN, body: { name: "Erik Granskare", email: RE, languages: ["sv"], clients: [A.id] } });
  ok(r.status === 201 && !r.data.invited && r.data.member.clients.length === 1, "without a signed agreement the member is saved but not invited");
  const member = r.data.member;
  await sleep(600);
  ok(!(await linkFor(RE, mark)), "no invite email goes out before the agreement is signed");
  r = await call("/auth/request-link", { method: "POST", body: { email: RE } });
  await sleep(600);
  ok(r.status === 200 && !(await linkFor(RE, mark)), "and they cannot sign in yet (neutral answer, no link)");
  mark = logSize();
  r = await call("/admin/team/" + member.id, { method: "PATCH", cookie: ADMIN, body: { agreementAt: "2026-10-06", resend: true } });
  ok(r.status === 200 && r.data.invited && r.data.member.agreementAt === "2026-10-06", "Agreement signed, then the invite goes out");
  const inv = await mailAfter(new RegExp("\\[dev mail\\] to=" + RE.replace(/[.+]/g, "\\$&") + " subject=Inbjudan: språkgranskning"), mark);
  ok(!!inv && /grow\/review/.test(inv), "the reviewer gets a Swedish invite that points to the review workspace");
  r = await call("/auth/verify", { method: "POST", body: { t: await linkFor(RE, mark) } });
  const RC = cookieOf(r);
  ok(r.status === 200 && r.data.role === "reviewer" && r.data.redirect === "/grow/review/" && !!RC, "the magic link signs the reviewer in to /grow/review/");
  r = await call("/auth/me", { cookie: RC });
  ok(r.data.role === "reviewer" && r.data.name === "Erik Granskare", "the session is a reviewer session");
  r = await call("/admin/clients", { cookie: RC });
  ok(r.status === 403, "a reviewer cannot use any admin endpoint");
  r = await call("/portal/state", { cookie: RC });
  ok(r.status === 403, "or any client endpoint");
  r = await call("", { abs: SITE + "/grow/review/" });
  ok(r.status === 200 && /reviewer\.js/.test(r.text), "the review workspace is served at /grow/review/");

  /* ---------- sending ---------- */
  r = await call("/admin/campaign/" + A.id, { method: "POST", cookie: ADMIN, body: { campaign: campaign(A.id, "sv") } });
  ok(r.status === 201, "a Swedish campaign is saved");
  r = await call("/admin/lang/" + A.id + "/cp_2026_11_sv", { cookie: ADMIN });
  ok(r.status === 200 && r.data.items.length === 0 && r.data.gate.required && r.data.gate.pending === r.data.fields, "Always review Swedish is on: the campaign is gated until its texts are approved");
  const en = await call("/admin/campaign/" + B.id, { method: "POST", cookie: ADMIN, body: { campaign: campaign(B.id, "en", { campaignId: "cp_2026_11_en" }) } });
  r = await call("/admin/lang/" + B.id + "/cp_2026_11_en/send", { method: "POST", cookie: ADMIN, body: {} });
  ok(en.status === 201 && r.status === 400 && r.data.error === "english", "an English campaign cannot be sent to language review");
  mark = logSize();
  r = await call("/admin/lang/" + A.id + "/cp_2026_11_sv/send", { method: "POST", cookie: ADMIN, body: { note: "Varm och personlig ton, tack.", due: "2026-10-09" } });
  const total = r.data.items.length;
  ok(r.status === 201 && total === fields.length && r.data.sent.created === total && r.data.sent.member.name === "Erik Granskare", "Send to language review queues every Swedish field for the assigned reviewer");
  ok(r.data.items.every((i) => i.state === "waiting" && i.machine && i.reviewed === null && i.approved === null), "each item holds its frozen machine text");
  const qmail = await mailAfter(new RegExp("\\[dev mail\\] to=" + RE.replace(/[.+]/g, "\\$&") + " subject=Texter väntar"), mark);
  ok(!!qmail && new RegExp(String(total)).test(qmail) && !/Comfort on your plate|Refer ten/.test(qmail), "the reviewer is told how many texts wait, with no content in the email");
  r = await call("/admin/lang/" + A.id + "/cp_2026_11_sv/send", { method: "POST", cookie: ADMIN, body: {} });
  ok(r.data.sent.created === 0 && r.data.sent.requeued === 0, "sending again does not duplicate anything");

  /* ---------- reviewer ---------- */
  r = await call("/review/queue", { cookie: RC });
  const q = r.data.items;
  ok(r.status === 200 && q.length === total && q.every((i) => i.clientName === "Svensk Salong" && i.campaignName === "Lite extra"), "the reviewer's queue has the assigned client's items");
  ok(q[0].note === "Varm och personlig ton, tack." && q[0].due === "2026-10-09" && q[0].context.avoid.includes("billigt"), "with Harry's note, the due date and the brand's words");
  const raw = JSON.stringify(r.data);
  ok(!/"intake"|"files"|founderStory|personas|apiKey|photo\.png/.test(raw), "and nothing else: no intake, uploads, personas or keys");
  const head = q.find((i) => i.path === "landingPage.headline");
  r = await call("/review/item/" + head.id, { cookie: RC });
  ok(r.status === 200 && r.data.item.machine === head.machine, "an item opens");
  ok(sql("SELECT COUNT(*) AS n FROM lang_log WHERE item_id = '" + head.id + "' AND action = 'view'")[0].n === 1, "every view is logged");
  r = await call("/review/item/" + head.id, { method: "PUT", cookie: RC, body: { draft: "Utkast till rubrik" } });
  ok(r.status === 200, "a draft saves itself");
  r = await call("/admin/lang/" + A.id + "/cp_2026_11_sv", { cookie: ADMIN });
  ok(r.data.items.find((i) => i.id === head.id).reviewed === null, "Harry sees nothing until it is Done");
  r = await call("/review/item/" + head.id + "/done", { method: "POST", cookie: RC, body: { text: "Komfort \u2014 på tallriken" } });
  ok(r.status === 400 && r.data.problems.some((p) => p.code === "dash"), "Done is refused with an em-dash");
  r = await call("/review/item/" + head.id + "/done", { method: "POST", cookie: RC, body: { text: "Billigt och gott" } });
  ok(r.status === 400 && r.data.problems.some((p) => p.code === "avoid"), "Done is refused with a word to avoid");
  r = await call("/review/item/" + head.id + "/done", { method: "POST", cookie: RC, body: { text: "x".repeat(201) } });
  ok(r.status === 400 && r.data.problems.some((p) => p.code === "length"), "Done is refused over the limit");
  r = await call("/review/item/" + head.id + "/done", { method: "POST", cookie: RC, body: { text: "Komfort på tallriken, ett sms bort", note: "Kortare och varmare." } });
  ok(r.status === 200 && r.data.state === "done", "a good text is marked Done");
  /* Another client's item, and a reviewer without access */
  await call("/admin/campaign/" + B.id, { method: "POST", cookie: ADMIN, body: { campaign: campaign(B.id, "sv") } });
  await call("/admin/lang/" + B.id + "/cp_2026_11_sv/send", { method: "POST", cookie: ADMIN, body: {} });
  const bItem = sql("SELECT id FROM lang_items WHERE client_id = '" + B.id + "' LIMIT 1")[0].id;
  r = await call("/review/item/" + bItem, { cookie: RC });
  ok(r.status === 404, "the reviewer cannot open a client they are not assigned to");
  r = await call("/review/queue", { cookie: RC });
  ok(r.data.items.every((i) => i.clientName === "Svensk Salong"), "and never sees that client in the queue");

  /* Flag and send back */
  const offer = q.find((i) => i.path === "offer.framing");
  mark = logSize();
  r = await call("/review/item/" + offer.id + "/flag", { method: "POST", cookie: RC, body: { comment: "Erbjudandet är otydligt, fråga kunden." } });
  ok(r.status === 200 && r.data.state === "flagged", "an unclear text is flagged with a comment");
  /* Every other text done */
  for (const it of q.filter((i) => i.id !== head.id && i.id !== offer.id)) {
    const p = await call("/review/item/" + it.id + "/done", { method: "POST", cookie: RC, body: { text: it.machine } });
    if (p.status !== 200) { console.log("done failed", it.path, JSON.stringify(p.data)); break; }
  }
  const notice = await mailAfter(/\[dev mail\] to=agborkak@gmail\.com subject=Språkgranskning \/ Language review: Svensk Salong/, mark);
  ok(!!notice && /1 flaggade|1 flagged/.test(notice) && !/Erbjudandet är otydligt/.test(notice), "Harry gets an email when nothing is left waiting, with no content");
  r = await call("/admin/lang/" + A.id + "/cp_2026_11_sv/accept-all", { method: "POST", cookie: ADMIN, body: {} });
  ok(r.status === 409 && r.data.error === "open", "Accept all waits while a text is flagged");
  r = await call("/admin/lang/item/" + offer.id, { method: "POST", cookie: ADMIN, body: { action: "send_back", comment: "Kunden bekräftar: tio vänner." } });
  ok(r.status === 200 && r.data.item.state === "sent_back" && r.data.item.round === 2, "Harry sends it back with a comment (round 2)");
  r = await call("/review/queue", { cookie: RC });
  ok(r.data.items.find((i) => i.id === offer.id).flagComment === "Kunden bekräftar: tio vänner.", "the reviewer sees why it came back");
  await call("/review/item/" + offer.id + "/done", { method: "POST", cookie: RC, body: { text: "Värva tio vänner i månaden, nästa tallrik bjuder vi på." } });

  /* ---------- the production gate ---------- */
  await call("/admin/page/" + A.id + "/cp_2026_11_sv", { method: "PUT", cookie: ADMIN, body: { clientSlug: "svensk-salong", slug: "lite-extra", offerEnd: "2099-12-31", settings: { phone: "+46701234567" }, links: [] } });
  r = await call("/admin/campaign/" + A.id + "/cp_2026_11_sv/review", { method: "POST", cookie: ADMIN, body: {} });
  ok(r.status === 409 && r.data.error === "lang_pending" && r.data.gate.pending === total, "the client cannot get the campaign while texts wait for approval");
  r = await call("/admin/page/" + A.id + "/cp_2026_11_sv/publish", { method: "POST", cookie: ADMIN, body: { html: "<!doctype html>" + "x".repeat(300), endedHtml: "x" } });
  ok(r.status === 409 && r.data.error === "lang_pending", "the landing page cannot be published either");
  r = await call("/admin/campaign/" + A.id + "/cp_2026_11_sv/status", { method: "PATCH", cookie: ADMIN, body: { status: "delivered", override: "Approved by phone" } });
  ok(r.status === 409 && r.data.error === "lang_pending", "nor delivered");

  /* ---------- Harry's decisions ---------- */
  r = await call("/admin/lang/" + A.id + "/cp_2026_11_sv", { cookie: ADMIN });
  const it2 = r.data.items;
  const h2 = it2.find((i) => i.id === head.id);
  ok(h2.state === "done" && h2.reviewed === "Komfort på tallriken, ett sms bort" && h2.reviewedBy.includes("Erik Granskare") && h2.machine === head.machine, "Harry sees machine and reviewed side by side, credited to the reviewer");
  const sub = it2.find((i) => i.path === "landingPage.subheadline");
  r = await call("/admin/lang/item/" + sub.id, { method: "POST", cookie: ADMIN, body: { action: "approve", text: "Äkta västafrikansk mat \u2014 lagad varje dag" } });
  ok(r.status === 400 && r.data.error === "checks", "Edit and approve runs the same checks");
  r = await call("/admin/lang/item/" + sub.id, { method: "POST", cookie: ADMIN, body: { action: "approve", text: "Äkta västafrikansk mat, lagad varje dag." } });
  ok(r.status === 200 && r.data.item.state === "approved" && r.data.item.approved === "Äkta västafrikansk mat, lagad varje dag.", "Edit and approve");
  const cta = it2.find((i) => i.path === "landingPage.cta");
  r = await call("/admin/lang/item/" + cta.id, { method: "POST", cookie: ADMIN, body: { action: "keep", reason: "ok" } });
  ok(r.status === 400, "Keep machine text needs a reason");
  r = await call("/admin/lang/item/" + cta.id, { method: "POST", cookie: ADMIN, body: { action: "keep", reason: "Varumärkets fasta knapptext" } });
  ok(r.status === 200 && r.data.item.state === "kept" && r.data.item.approved === cta.machine, "Keep machine text, with the reason logged");
  r = await call("/admin/lang/" + A.id + "/cp_2026_11_sv/accept-all", { method: "POST", cookie: ADMIN, body: {} });
  ok(r.status === 200 && r.data.gate.pending === 0 && r.data.items.every((i) => i.state === "approved" || i.state === "kept"), "Accept all approves every Done text");
  ok(r.data.approved["landingPage.headline"] === "Komfort på tallriken, ett sms bort", "the approved map holds the reviewed wording");
  const versions = sql("SELECT kind, text FROM lang_versions WHERE item_id = '" + head.id + "' ORDER BY id");
  ok(versions.map((v) => v.kind).join(",") === "machine,reviewed,approved" && versions[0].text === head.machine, "three versions stored apart; the machine text never changed");

  /* The client sees the approved text */
  r = await call("/admin/campaign/" + A.id + "/cp_2026_11_sv/review", { method: "POST", cookie: ADMIN, body: {} });
  ok(r.status === 201, "now the campaign goes to the client");
  r = await call("/portal/campaign/cp_2026_11_sv", { cookie: A.cookie });
  const lp = r.data.review.view.cards.find((c) => c.key === "landingPage");
  ok(lp.text.includes("Komfort på tallriken, ett sms bort") && lp.text.includes("Äkta västafrikansk mat, lagad varje dag.") && !lp.text.includes(head.machine), "the client only sees approved text");

  /* ---------- outdated ---------- */
  const d2 = (await call("/admin/campaign/" + A.id + "/cp_2026_11_sv", { cookie: ADMIN })).data.campaign;
  d2.landingPage.headline = "Ny maskinrubrik efter ändring";
  r = await call("/admin/campaign/" + A.id, { method: "POST", cookie: ADMIN, body: { campaign: d2 } });
  r = await call("/admin/lang/" + A.id + "/cp_2026_11_sv", { cookie: ADMIN });
  const h3 = r.data.items.find((i) => i.id === head.id);
  ok(h3.state === "outdated" && !("landingPage.headline" in r.data.approved) && r.data.gate.pending === 1, "editing a sent text marks it Outdated; its old approval is no longer used");
  r = await call("/admin/lang/item/" + head.id, { method: "POST", cookie: ADMIN, body: { action: "keep", reason: "Behåll maskinens text" } });
  ok(r.status === 409, "an Outdated text cannot be approved without a new look");
  r = await call("/admin/lang/" + A.id + "/cp_2026_11_sv/send", { method: "POST", cookie: ADMIN, body: { paths: ["landingPage.headline"] } });
  const h4 = r.data.items.find((i) => i.id === head.id);
  ok(r.data.sent.requeued === 1 && h4.state === "waiting" && h4.round === 2 && h4.machine === "Ny maskinrubrik efter ändring", "sending it again starts round 2 with the new machine text");
  r = await call("/admin/campaign/" + A.id + "/cp_2026_11_sv/status", { method: "PATCH", cookie: ADMIN, body: { status: "delivered", override: "Approved by phone", langOverride: "Kunden godkände rubriken muntligt" } });
  ok(r.status === 200, "Harry can override the gate with a reason");
  ok(sql("SELECT COUNT(*) AS n FROM lang_log WHERE client_id = '" + A.id + "' AND action = 'gate_override'")[0].n === 1, "the override is logged");

  /* ---------- notes and setting ---------- */
  r = await call("/admin/lang/notes/" + A.id, { method: "POST", cookie: ADMIN, body: { preferred: "sms, inte textmeddelande", reason: "Låter naturligare", fromItem: head.id } });
  ok(r.status === 200 && r.data.notes[0].preferred === "sms, inte textmeddelande", "a language note is saved for the client");
  r = await call("/admin/lang/setting/" + B.id, { method: "PUT", cookie: ADMIN, body: { review: false } });
  ok(r.status === 200 && r.data.alwaysReview === false, "Always review Swedish can be turned off per client");

  /* ---------- deactivate ---------- */
  r = await call("/admin/team/" + member.id, { method: "PATCH", cookie: ADMIN, body: { active: false } });
  ok(r.status === 200 && !r.data.member.active, "a reviewer is deactivated");
  r = await call("/review/queue", { cookie: RC });
  ok(r.status === 401, "and their session ends at once");
  ok(sql("SELECT COUNT(*) AS n FROM lang_versions WHERE author LIKE 'Erik Granskare%'")[0].n > 0, "their past edits stay, credited to them");

  /* ---------- export and erasure ---------- */
  r = await call("/admin/export/" + A.id, { cookie: ADMIN });
  ok(r.status === 200 && r.data.languageReview.items.length === total && r.data.languageReview.versions.length > total && r.data.languageReview.notes.length === 1 && r.data.languageReview.log.length > 0, "the export includes items, versions, notes and the log");
  r = await call("/admin/clients/" + A.id, { method: "DELETE", cookie: ADMIN, body: { confirm: A.email } });
  ok(r.status === 200 && r.data.remaining.rows === 0, "erasure leaves nothing");
  ok(["lang_items", "lang_versions", "lang_notes", "lang_log", "team_access"].every((t) => sql("SELECT COUNT(*) AS n FROM " + t + " WHERE client_id = '" + A.id + "'")[0].n === 0), "no language review rows remain for the client");
} catch (e) {
  fail++;
  console.log("FAIL crashed: " + e.stack);
}
console.log("\n" + pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
