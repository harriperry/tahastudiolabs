/* Markets step 2: the campaign languages. English, Swedish, French, Spanish, Nigerian Pidgin
   and Cameroonian Pidgin (plus the older Swedish and English). Swedish and Spanish go to a
   human reviewer of that language; the others Harry approves himself. Pages get French and
   Spanish words; the Pidgins use English buttons and notices.
   Same local setup as lang.test.mjs (started by test/run-all.mjs). */
import fs from "node:fs";
import { execFileSync } from "node:child_process";

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

import { CAMPAIGN_LANGUAGES, LANGUAGES, REVIEW_LANGUAGES, brainLanguages, campaignLanguageFromBrain, pageLanguage, reviewLanguage } from "../../../assets/growth-languages.js";
import { langFields } from "../../../assets/growth-langfields.js";
import { L, campaignText, formatDate, privacyNotice, textWithLink } from "../../../assets/growth-landing.js";

async function newClient(name, language, market) {
  const email = "ml-" + name.toLowerCase().replace(/[^a-z]+/g, "-") + "-" + run + "@example.com";
  const mark = logSize();
  let r = await call("/admin/clients", { method: "POST", cookie: ADMIN, body: { name, email, language: "en", market: market || "SE" } });
  const id = r.data.client.id;
  r = await call("/auth/verify", { method: "POST", body: { t: await linkFor(email, mark) } });
  const cookie = cookieOf(r);
  await call("/consent", { method: "POST", cookie, body: { accepted: true, language: "en" } });
  r = await call("/uploads?section=pictures", { method: "POST", cookie, raw: PNG, headers: { "Content-Type": "image/png", "X-File-Name": "photo.png" } });
  const fixture = read("./fixtures/pilot-intake-v1.json");
  const put = await call("/intake", { method: "PUT", cookie, body: { answerLanguage: "en", campaignLanguage: language, profile: fixture.profile, uploads: { pictures: [{ fileId: r.data.file.id, name: "photo.png", mime: "image/png" }], founderStory: { text: "Story.", fileId: null }, previousPosts: [], faqs: { rows: [], fileId: null } } } });
  const sub = await call("/intake/submit", { method: "POST", cookie, body: {} });
  const brain = Object.assign(read("./fixtures/pilot-brain-v1.json"), { builtFromIntakeVersion: 1, editedByHarry: false, languages: brainLanguages(language) });
  const br = await call("/admin/brain/" + id, { method: "POST", cookie: ADMIN, body: { brain } });
  return { id, email, cookie, put, sub, br };
}
function campaign(clientId, language, extra) {
  const m = read("./fixtures/pilot-campaign-model.json");
  m.socialCopy = m.socialCopy.map((p) => (p.channel === "google_business" ? Object.assign(p, { hashtags: [] }) : p));
  return Object.assign({ schemaVersion: "campaign-1", clientId, campaignId: "cp_2026_11_" + language, brainVersion: 1, name: "Campaign " + language, month: "2026-11", goal: "sales", language, channels: ["instagram", "facebook", "google_business"], status: "in_production" }, m, extra || {});
}
async function signInMember(name, email, languages, clients) {
  let mark = logSize();
  let r = await call("/admin/team/invite", { method: "POST", cookie: ADMIN, body: { name, email, languages, clients, agreementAt: "2026-10-07" } });
  const member = r.data.member;
  const tok = await linkFor(email, mark);
  r = await call("/auth/verify", { method: "POST", body: { t: tok } });
  return { member, cookie: cookieOf(r) };
}

try {
  /* ---------- the shared list ---------- */
  ok(CAMPAIGN_LANGUAGES.join() === "en,sv,both,fr,es,pcm,wes", "seven campaign languages: English, Swedish, both, French, Spanish, Nigerian Pidgin, Cameroonian Pidgin");
  ok(REVIEW_LANGUAGES.join() === "sv,es", "only Swedish and Spanish go to a recruited reviewer");
  ok(reviewLanguage("both") === "sv" && reviewLanguage("es") === "es" && ["en", "fr", "pcm", "wes", "xx"].every((x) => reviewLanguage(x) === null), "Harry approves English, French and the two Pidgins himself");
  ok(pageLanguage("fr") === "fr" && pageLanguage("es") === "es" && pageLanguage("pcm") === "en" && pageLanguage("wes") === "en" && pageLanguage("both") === "sv", "pages: French and Spanish words; the Pidgins use English buttons and notices");
  ok(brainLanguages("both").join() === "sv,en" && brainLanguages("wes").join() === "wes" && campaignLanguageFromBrain(["pcm"]) === "pcm" && campaignLanguageFromBrain(["sv", "en"]) === "both" && campaignLanguageFromBrain([]) === "en", "the brain's languages and the campaign language map both ways");

  /* ---------- schemas and prompts ---------- */
  const sch = (n) => read("../schemas/" + n + ".schema.json");
  ok(["fr", "es", "pcm", "wes"].every((x) => sch("campaign").properties.language.enum.includes(x) && sch("intake").properties.campaignLanguage.enum.includes(x) && sch("brain").properties.languages.items.enum.includes(x)), "the schemas accept the new languages");
  const prompts = ["brain", "campaign", "visuals"].map((n) => read("../../../assets/growth/" + n + ".prompt.json"));
  ok(prompts.every((p) => CAMPAIGN_LANGUAGES.every((x) => typeof p.languageRules[x] === "string" && p.languageRules[x].length > 40)), "every prompt has a language rule for every campaign language");
  ok(/Kamtok/.test(prompts[1].languageRules.wes) && /Naija/.test(prompts[1].languageRules.pcm) && /concept\.whyNow/.test(prompts[1].languageRules.es) && /Set languages to \["fr"\]/.test(prompts[0].languageRules.fr), "the rules name Kamtok and Naija, keep Harry's notes in English, and set the brain's language");
  const allText = prompts.map((p) => JSON.stringify(p)).join("") + fs.readFileSync(new URL("../../../assets/growth-languages.js", import.meta.url), "utf8") + fs.readFileSync(new URL("../../../assets/growth-landing.js", import.meta.url), "utf8") + fs.readFileSync(new URL("../src/track.js", import.meta.url), "utf8") + fs.readFileSync(new URL("../src/pages.js", import.meta.url), "utf8");
  ok(!allText.includes("—"), "no em-dash in the language files");

  /* ---------- campaign page words ---------- */
  ok(["fr", "es"].every((l) => Object.keys(L[l]).join() === Object.keys(L.en).join()), "French and Spanish pages have every word the English page has");
  const doc = campaign("cl_x", "es");
  ok(campaignText(doc).language === "es" && campaignText(campaign("cl_x", "wes")).language === "en" && campaignText(campaign("cl_x", "both")).language === "sv", "a campaign's page takes its page language");
  ok(/octobre/.test(formatDate("2026-10-31", "fr")) && /octubre/.test(formatDate("2026-10-31", "es")), "dates are written in French and Spanish");
  ok(textWithLink({ socialCopy: [{ channel: "instagram", text: "Hola", hashtags: [] }] }, "post.instagram", "https://x.test/a", "SANDY-IG", "es").includes("Usa el código SANDY-IG"), "the offer code line is in the page language");
  const pn = privacyNotice({ lang: "fr", company: "Chez Sandy", settings: { email: "a@b.c" }, formOn: true, offerEndText: "31 octobre 2026", tahaEmail: "t@t.t" });
  ok(pn.length === 6 && /Responsable du traitement/.test(pn[0]) && /90 jours/.test(pn[3]), "the privacy notice exists in French (and Spanish)");
  ok(privacyNotice({ lang: "es", company: "X", settings: {}, formOn: false, tahaEmail: "t@t.t" }).length === 4, "the Spanish notice leaves out the form lines when there is no form");

  /* ---------- review fields ---------- */
  const withVis = (l) => campaign("cl_x", l, { visuals: [{ id: "v_offer", placement: "Offer", overlay: { headline: "H", sub: "S", cta: "C" }, alt_text: { sv: "Bild", en: "Photo" } }] });
  ok(langFields(withVis("sv")).some((f) => f.path.endsWith("alt_text.sv")) && !langFields(withVis("es")).some((f) => f.path.includes("alt_text")), "a Swedish review checks the Swedish alt text; a Spanish one does not");

  /* ---------- the Vault ---------- */
  const ES = await newClient("Taqueria Sol", "es");
  ok(ES.put.status === 200 && ES.sub.status === 200 && ES.br.status < 300, "a client can choose Spanish in her intake, and a Spanish brain is saved");
  const WES = await newClient("Mami Ndole", "wes", "CM");
  ok(WES.sub.status === 200 && WES.br.status < 300, "Cameroonian Pidgin passes the intake and the brain");
  const SV = await newClient("Svensk Kund", "sv");

  let r = await call("/admin/campaign/" + ES.id, { method: "POST", cookie: ADMIN, body: { campaign: campaign(ES.id, "es") } });
  ok(r.status === 201, "a Spanish campaign is saved");
  r = await call("/admin/campaign/" + WES.id, { method: "POST", cookie: ADMIN, body: { campaign: campaign(WES.id, "wes") } });
  ok(r.status === 201, "a Cameroonian Pidgin campaign is saved");
  r = await call("/admin/campaign/" + SV.id, { method: "POST", cookie: ADMIN, body: { campaign: campaign(SV.id, "sv") } });
  r = await call("/admin/campaign/" + ES.id, { method: "POST", cookie: ADMIN, body: { campaign: campaign(ES.id, "fr") } });
  ok(r.status === 201, "French is accepted too");

  r = await call("/admin/lang/" + WES.id + "/cp_2026_11_wes/send", { method: "POST", cookie: ADMIN, body: {} });
  ok(r.status === 400 && r.data.error === "english", "a Pidgin campaign is not sent to a reviewer");
  r = await call("/admin/lang/" + WES.id + "/cp_2026_11_wes", { cookie: ADMIN });
  ok(r.data.reviewLanguage === null && r.data.gate.required === false, "and nothing waits for review: Harry approves it himself");
  r = await call("/admin/lang/" + ES.id + "/cp_2026_11_fr/send", { method: "POST", cookie: ADMIN, body: {} });
  ok(r.status === 400, "nor is a French campaign");
  r = await call("/admin/lang/" + ES.id + "/cp_2026_11_es", { cookie: ADMIN });
  ok(r.data.reviewLanguage === "es" && r.data.reviewLanguageName === "Spanish" && r.data.gate.required && r.data.reviewer === null, "a Spanish campaign waits for a Spanish review; no reviewer yet");

  /* Reviewers: a Swedish one and a Spanish one, both assigned to both clients. */
  const SVR = await signInMember("Erik Svensk", "rev-sv-" + run + "@example.com", ["sv"], [ES.id, SV.id]);
  let mark = logSize();
  r = await call("/admin/team/invite", { method: "POST", cookie: ADMIN, body: { name: "Lucia Espanol", email: "rev-es-" + run + "@example.com", languages: ["es", "xx"], clients: [ES.id, SV.id], agreementAt: "2026-10-07" } });
  ok(r.status === 201 && r.data.member.languages.join() === "es", "a Spanish reviewer is invited (unknown languages dropped)");
  const esMember = r.data.member;
  const inv = await mailAfter(new RegExp("\\[dev mail\\] to=rev-es-" + run + "@example\\.com subject=Invitation: language review"), mark);
  ok(!!inv, "her invite email is English first");
  r = await call("/auth/verify", { method: "POST", body: { t: await linkFor("rev-es-" + run + "@example.com", mark) } });
  const ESR = { member: esMember, cookie: cookieOf(r) };

  r = await call("/admin/lang/" + ES.id + "/cp_2026_11_es", { cookie: ADMIN });
  ok(r.data.reviewer && r.data.reviewer.name === "Lucia Espanol", "the Spanish campaign finds the Spanish reviewer, not the Swedish one");
  r = await call("/admin/lang/" + ES.id + "/cp_2026_11_es/send", { method: "POST", cookie: ADMIN, body: {} });
  ok(r.status === 201 && r.data.items.length > 10 && r.data.items.every((i) => i.language === "es") && r.data.sent.member.name === "Lucia Espanol", "its texts are queued as Spanish items for her");
  await call("/admin/lang/" + SV.id + "/cp_2026_11_sv/send", { method: "POST", cookie: ADMIN, body: {} });

  r = await call("/review/queue", { cookie: ESR.cookie });
  ok(r.status === 200 && r.data.items.length > 0 && r.data.items.every((i) => i.language === "es"), "the Spanish reviewer sees only Spanish texts, though she is assigned to the Swedish client too");
  const esItem = r.data.items[0];
  r = await call("/review/queue", { cookie: SVR.cookie });
  ok(r.data.items.length > 0 && r.data.items.every((i) => i.language === "sv"), "the Swedish reviewer sees only Swedish texts");
  const svItem = r.data.items[0];
  r = await call("/review/item/" + svItem.id, { cookie: ESR.cookie });
  ok(r.status === 404, "the Spanish reviewer cannot open a Swedish text");
  r = await call("/review/item/" + esItem.id + "/done", { method: "POST", cookie: SVR.cookie, body: { text: "x" } });
  ok(r.status === 404, "nor can the Swedish reviewer finish a Spanish one");
  r = await call("/review/item/" + esItem.id + "/done", { method: "POST", cookie: ESR.cookie, body: { text: esItem.machine } });
  ok(r.status === 200 && r.data.state === "done", "the Spanish reviewer marks her text Done");

  r = await call("/admin/team/" + SVR.member.id, { method: "PATCH", cookie: ADMIN, body: { languages: ["sv", "es"] } });
  ok(r.status === 200 && r.data.member.languages.join() === "sv,es", "Harry can let a reviewer check both languages");
  await call("/admin/team/" + esMember.id, { method: "PATCH", cookie: ADMIN, body: { active: false } });
  r = await call("/admin/lang/" + ES.id + "/cp_2026_11_es", { cookie: ADMIN });
  ok(r.data.reviewer && r.data.reviewer.name === "Erik Svensk", "and then they are the Spanish reviewer when nobody else is (texts already sent stay with whoever has them)");
  r = await call("/admin/team/" + SVR.member.id, { method: "PATCH", cookie: ADMIN, body: { languages: ["fr"] } });
  ok(r.status === 400, "a language without review cannot be given to a reviewer");

  /* Pages in French and Spanish */
  const settings = { companyName: "Taqueria Sol", phone: "+34600000000", primary: "call", reviews: [], gallery: [] };
  r = await call("/admin/page/" + ES.id + "/cp_2026_11_es", { method: "PUT", cookie: ADMIN, body: { clientSlug: "taqueria-" + run, slug: "noviembre", language: "es", settings, langOverride: "test" } });
  ok(r.status < 300 && r.data.page.language === "es", "a campaign page is stored as Spanish");
  r = await call("/admin/page/" + ES.id + "/cp_2026_11_fr", { method: "PUT", cookie: ADMIN, body: { clientSlug: "taqueria-" + run, slug: "novembre", language: "fr", settings } });
  ok(r.status < 300 && r.data.page.language === "fr", "or French");

  r = await call("/health");
  ok(r.data && r.data.part === "l2", "health reports Markets step 2");
} catch (e) {
  fail++;
  console.log("FAIL crashed: " + (e && e.stack || e));
}
console.log("\n" + pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
