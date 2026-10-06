/* ScriptForge Growth Clients panel: the Campaign Generator (TAHA Growth Department V1, phase 5).
   Loaded by growth.js for the admin only, as an ES module.

   Generate, step by step:
   1. Harry picks campaign name, month, goal, the offer to push (from the brain or typed),
      language (from the brain, can be changed) and channels.
   2. One prompt (assets/growth/campaign.prompt.json) goes through ScriptForge's own
      /api/format relay with the provider, key and model from section 2, together with the
      latest saved Business Brain. The key never goes to the Brain Vault.
   3. The answer is checked against campaign.schema.json plus a few house checks (one social
      post per chosen channel). On failure it retries once with the list of problems.
   4. Em-dashes are replaced and every text is checked for the brain's words to avoid; any hit is
      flagged on its card.
   5. The concept plus nine outputs show as cards, each with Regenerate (that card only), Copy
      and Edit. The short video card has Send to ScriptForge.
   6. Save campaign stores it in the Vault (status: Campaign in production), Mark delivered sets
      Campaign delivered, and Export downloads the campaign as JSON and as a formatted HTML page.
   An unsaved campaign is kept in this browser (localStorage) until it is saved or discarded.

   V2 phase G1: step 2, Make visuals, writes the Visual Pack (growth-visuals.js) and turns the
   campaign into a campaign-2 document. Add visuals does the same for campaigns made before
   Part G. Send to ScriptForge targets HeyGen or Veo 3.1. */
import { validate } from "./growth-validate.js?v=p5";
import { callModel, extractJson, fillTemplate, fitToSchema, stripDashes } from "./growth-brain.js?v=p5";
import {
  PLATFORMS_URL,
  VISUALS_PROMPT_URL,
  brainForVisuals,
  briefModelSchema,
  briefsFor,
  buildSlots,
  checkVisuals,
  createVisualsUi,
  kitPromptText,
  normalizeVisuals,
  overlayText,
  photoList,
  sizeLabel,
  withVisuals
} from "./growth-visuals.js?v=g1";

const VAULT = "/api/vault";
const PROMPT_URL = "/assets/growth/campaign.prompt.json?v=p5";
const DRAFT_PREFIX = "taha-growth-campaign-draft:";
const SET_BY_SCRIPTFORGE = ["schemaVersion", "clientId", "campaignId", "brainVersion", "name", "month", "goal", "language", "channels", "status"];

export const CHANNELS = [
  ["instagram", "Instagram"],
  ["facebook", "Facebook"],
  ["tiktok", "TikTok"],
  ["linkedin", "LinkedIn"],
  ["google_business", "Google Business"],
  ["email", "Email"]
];
const CHANNEL_LABEL = Object.fromEntries(CHANNELS);
const GOALS = [["awareness", "Awareness"], ["bookings", "Bookings"], ["sales", "Sales"], ["launch", "Launch"]];
const LANGS = [["en", "English"], ["sv", "Svenska"], ["both", "Swedish and English"]];
const LANG_LABEL = Object.fromEntries(LANGS);
const NO_HASHTAGS = ["google_business", "email"];

/* ---------- pure helpers (exported for tests) ---------- */

export function campaignModelSchema(schema) {
  const s = JSON.parse(JSON.stringify(schema));
  for (const k of SET_BY_SCRIPTFORGE) delete s.properties[k];
  /* The Visual Pack is written by its own step (Make visuals), never with the campaign. */
  delete s.properties.visuals;
  delete s.properties.visualsMadeAt;
  s.required = s.required.filter((k) => !SET_BY_SCRIPTFORGE.includes(k));
  delete s.$id;
  delete s.$schema;
  delete s.description;
  return s;
}

export function monthLabel(month, lang) {
  const [y, m] = String(month).split("-").map(Number);
  if (!y || !m) return month;
  return new Date(Date.UTC(y, m - 1, 15)).toLocaleString(lang === "sv" ? "sv-SE" : "en-GB", { month: "long", year: "numeric", timeZone: "UTC" });
}

export function defaultName(month, company, lang) {
  const [y, m] = String(month).split("-").map(Number);
  if (lang === "sv") {
    const mon = y && m ? new Date(Date.UTC(y, m - 1, 15)).toLocaleString("sv-SE", { month: "long", timeZone: "UTC" }) : "månads";
    return mon.charAt(0).toUpperCase() + mon.slice(1) + "kampanj för " + company;
  }
  const mon = y && m ? new Date(Date.UTC(y, m - 1, 15)).toLocaleString("en-GB", { month: "long", timeZone: "UTC" }) : "Monthly";
  return mon + " campaign for " + company;
}

export function languageFromBrain(brain) {
  const l = (brain && brain.languages) || [];
  if (l.includes("sv") && l.includes("en")) return "both";
  return l.includes("sv") ? "sv" : "en";
}

export function campaignIdFor(month, language, taken) {
  const base = "cp_" + String(month).replace("-", "_") + "_" + language;
  if (!taken.includes(base)) return base;
  for (let n = 2; n < 100; n++) if (!taken.includes(base + "_" + n)) return base + "_" + n;
  return base + "_" + Date.now().toString(36);
}

function cleanTag(t) {
  const s = String(t || "").trim().replace(/\s+/g, "");
  if (!s) return "";
  return s.startsWith("#") ? s : "#" + s;
}

/* Fills in what ScriptForge owns and tidies the model's answer. Returns {doc, problems}. */
export function normalizeCampaign(raw, meta, schema) {
  const doc = stripDashes(Object.assign({}, raw));
  for (const k of SET_BY_SCRIPTFORGE) delete doc[k];
  doc.shortVideo = Object.assign({}, doc.shortVideo || {}, { ratio: "9:16", seconds: 30 });
  const problems = [];
  if (Array.isArray(doc.socialCopy)) {
    const byCh = {};
    doc.socialCopy.forEach((p) => { if (p && meta.channels.includes(p.channel) && !byCh[p.channel]) byCh[p.channel] = p; });
    doc.socialCopy = meta.channels.filter((c) => byCh[c]).map((c) => {
      const p = byCh[c];
      const tags = NO_HASHTAGS.includes(c) ? [] : (Array.isArray(p.hashtags) ? p.hashtags : []).map(cleanTag).filter(Boolean);
      return { channel: c, text: p.text, hashtags: Array.from(new Set(tags)) };
    });
    const missing = meta.channels.filter((c) => !byCh[c]);
    if (missing.length) problems.push("socialCopy: missing a post for " + missing.join(", ") + " (one post per selected channel, in this order: " + meta.channels.join(", ") + ")");
  }
  const full = Object.assign(
    {
      schemaVersion: Array.isArray(doc.visuals) && doc.visuals.length ? "campaign-2" : "campaign-1",
      clientId: meta.clientId,
      campaignId: meta.campaignId,
      brainVersion: meta.brainVersion,
      name: meta.name,
      month: meta.month,
      goal: meta.goal,
      language: meta.language,
      channels: meta.channels
    },
    doc,
    { status: "in_production" }
  );
  return { doc: fitToSchema(schema, full), problems };
}

/* Every place a word to avoid appears, per top-level output. */
export function findAvoidWords(doc, avoid) {
  const words = (avoid || []).map((w) => String(w || "").trim()).filter(Boolean);
  const hits = {};
  if (!words.length || !doc) return hits;
  const keys = ["concept", "hook", "offer", "shortVideo", "socialCopy", "adVariations", "cta", "landingPage", "email", "googleBusinessPost", "visuals"];
  for (const k of keys) {
    const text = JSON.stringify(doc[k] || "").toLowerCase();
    const found = words.filter((w) => {
      const lw = w.toLowerCase();
      if (/\s/.test(lw)) return text.includes(lw);
      const esc = lw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      return new RegExp("(^|[^\\p{L}\\p{N}])" + esc + "([^\\p{L}\\p{N}]|$)", "u").test(text);
    });
    if (found.length) hits[k] = found;
  }
  return hits;
}

const pad = (s) => String(s == null ? "" : s);

/* Plain text for Copy, one function per output. */
export function cardText(key, v) {
  if (!v) return "";
  switch (key) {
    case "concept": return [v.title, "", "Big idea: " + pad(v.bigIdea), "Key message: " + pad(v.keyMessage), "Why now: " + pad(v.whyNow)].join("\n");
    case "hook": return v.map((x, i) => i + 1 + ". " + x).join("\n");
    case "offer": return [pad(v.framing), "", "Terms: " + pad(v.terms), "Deadline: " + pad(v.deadline), "Reassurance: " + pad(v.riskReversal)].join("\n");
    case "shortVideo": return pad(v.script);
    case "socialCopy": return v.map((p) => (CHANNEL_LABEL[p.channel] || p.channel).toUpperCase() + "\n" + pad(p.text) + (p.hashtags && p.hashtags.length ? "\n\n" + p.hashtags.join(" ") : "")).join("\n\n----\n\n");
    case "adVariations": return v.map((a, i) => "Ad " + (i + 1) + " (" + pad(a.angle) + ")\nHeadline: " + pad(a.headline) + "\nPrimary text: " + pad(a.primaryText) + "\nDescription: " + pad(a.description)).join("\n\n");
    case "cta": return v.map((c) => pad(c.text) + " [" + pad(c.button) + "]").join("\n");
    case "landingPage": return [pad(v.headline), pad(v.subheadline), ""].concat((v.benefits || []).map((b) => pad(b.title) + ": " + pad(b.text))).concat(["", "Proof:"], (v.proof || []).map((p) => "- " + p), ["", "FAQ:"], (v.faq || []).map((q) => "Q: " + pad(q.q) + "\nA: " + pad(q.a)), ["", "CTA: " + pad(v.cta)]).join("\n");
    case "email": return ["Subject A: " + pad((v.subjects || [])[0]), "Subject B: " + pad((v.subjects || [])[1]), "Preview: " + pad(v.preview), "", pad(v.body), "", "CTA: " + pad(v.cta)].join("\n");
    case "googleBusinessPost": return pad(v.text) + "\n\nButton: " + pad(v.ctaType);
    default: return JSON.stringify(v, null, 2);
  }
}

function esc(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

/* A formatted, self-contained HTML page of the whole campaign, for the export. */
export function campaignHtml(doc, company) {
  const sec = (title, body) => "<section><h2>" + esc(title) + "</h2>" + body + "</section>";
  const p = (t) => "<p>" + esc(t).replace(/\n/g, "<br>") + "</p>";
  const list = (arr, ordered) => "<" + (ordered ? "ol" : "ul") + ">" + (arr || []).map((x) => "<li>" + esc(x) + "</li>").join("") + "</" + (ordered ? "ol" : "ul") + ">";
  const c = doc.concept || {};
  const o = doc.offer || {};
  const lp = doc.landingPage || {};
  const em = doc.email || {};
  const g = doc.googleBusinessPost || {};
  const parts = [
    sec("Concept", "<h3>" + esc(c.title) + "</h3>" + p("Big idea: " + pad(c.bigIdea)) + p("Key message: " + pad(c.keyMessage)) + p("Why now: " + pad(c.whyNow))),
    sec("1. Hooks", list(doc.hook, true)),
    sec("2. Offer", p(o.framing) + p("Terms: " + pad(o.terms)) + p("Deadline: " + pad(o.deadline)) + p("Reassurance: " + pad(o.riskReversal))),
    sec("3. Short video (30 s, 9:16)", "<pre>" + esc((doc.shortVideo || {}).script) + "</pre>"),
    sec("4. Social copy", (doc.socialCopy || []).map((s) => "<h3>" + esc(CHANNEL_LABEL[s.channel] || s.channel) + "</h3>" + p(s.text) + (s.hashtags && s.hashtags.length ? p(s.hashtags.join(" ")) : "")).join("")),
    sec("5. Ad variations", (doc.adVariations || []).map((a, i) => "<h3>Ad " + (i + 1) + ": " + esc(a.angle) + "</h3>" + p("Headline: " + pad(a.headline)) + p(a.primaryText) + p("Description: " + pad(a.description))).join("")),
    sec("6. Calls to action", "<ul>" + (doc.cta || []).map((x) => "<li>" + esc(x.text) + " <b>[" + esc(x.button) + "]</b></li>").join("") + "</ul>"),
    sec("7. Landing page", "<h3>" + esc(lp.headline) + "</h3>" + p(lp.subheadline) + (lp.benefits || []).map((b) => "<h4>" + esc(b.title) + "</h4>" + p(b.text)).join("") + "<h4>Proof</h4>" + list(lp.proof) + "<h4>FAQ</h4>" + (lp.faq || []).map((q) => p("Q: " + pad(q.q)) + p("A: " + pad(q.a))).join("") + p("CTA: " + pad(lp.cta))),
    sec("8. Email", p("Subject A: " + pad((em.subjects || [])[0])) + p("Subject B: " + pad((em.subjects || [])[1])) + p("Preview: " + pad(em.preview)) + p(em.body) + p("CTA: " + pad(em.cta))),
    sec("9. Google Business post", p(g.text) + p("Button: " + pad(g.ctaType)))
  ];
  if (Array.isArray(doc.visuals) && doc.visuals.length) {
    parts.push(sec("Visual Pack (" + doc.visuals.length + " briefs)", doc.visuals.map((v) =>
      "<h3>" + esc(v.placement) + " · " + esc(sizeLabel(v)) + "</h3>" +
      p(v.source === "client_photo" ? (v.photo_ref ? "Client photo " + v.photo_ref + ": " : "PHOTO NEEDED FROM CLIENT: ") + v.prompt : v.prompt) +
      p("Overlay: " + overlayText(v).replace(/\n/g, " / ")) + p("Keep clear: " + v.clear_zone) + p("Alt text: " + v.alt_text.sv + " / " + v.alt_text.en)
    ).join("")));
  }
  const meta = [monthLabel(doc.month, "en"), "Goal: " + doc.goal, "Language: " + (LANG_LABEL[doc.language] || doc.language), "Channels: " + (doc.channels || []).map((x) => CHANNEL_LABEL[x] || x).join(", "), "Brain v" + doc.brainVersion].join(" · ");
  return "<!doctype html><html lang=\"" + (doc.language === "sv" ? "sv" : "en") + "\"><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\"><title>" + esc(doc.name) + "</title>" +
    "<style>body{font-family:Arial,Helvetica,sans-serif;max-width:860px;margin:0 auto;padding:32px 16px;color:#14161C;background:#F6F1E7;line-height:1.55}h1{font-size:28px;margin:0 0 6px}.meta{color:#5E6470;font-size:14px;margin-bottom:24px}section{background:#fff;border:1px solid #DDD5C6;border-radius:10px;padding:18px 22px;margin:0 0 16px}h2{font-size:15px;text-transform:uppercase;letter-spacing:1px;color:#8A5D08;margin:0 0 10px}h3{font-size:17px;margin:14px 0 6px}h4{margin:12px 0 4px}pre{white-space:pre-wrap;font-family:inherit;background:#F6F1E7;padding:12px;border-radius:8px}.foot{color:#5E6470;font-size:12px}</style></head><body>" +
    "<h1>" + esc(doc.name) + "</h1><div class=\"meta\">" + esc(company) + " · " + esc(meta) + "</div>" + parts.join("") +
    "<p class=\"foot\">TAHA Studio Labs Growth Department · " + esc(doc.campaignId) + "</p></body></html>";
}

/* ---------- the cards ---------- */

const CARDS = [
  { key: "concept", title: "Campaign concept", fields: [
    { k: "title", label: "Title", type: "text" },
    { k: "bigIdea", label: "Big idea", type: "area", rows: 2 },
    { k: "keyMessage", label: "Key message", type: "area", rows: 2 },
    { k: "whyNow", label: "Why it fits this audience this month", type: "area", rows: 3 }
  ] },
  { key: "hook", n: 1, title: "Hooks", kind: "lines", label: "5 lines, best first (one per line)" },
  { key: "offer", n: 2, title: "Offer", fields: [
    { k: "framing", label: "Framing", type: "area", rows: 3 },
    { k: "terms", label: "Terms", type: "area", rows: 2 },
    { k: "deadline", label: "Deadline", type: "text" },
    { k: "riskReversal", label: "Reassurance", type: "area", rows: 2 }
  ] },
  { key: "shortVideo", n: 3, title: "Short video · 30 s · 9:16", fields: [{ k: "script", label: "Script (three 10 second segments)", type: "area", rows: 14 }] },
  { key: "socialCopy", n: 4, title: "Social copy", kind: "rows", itemTitle: (x) => CHANNEL_LABEL[x.channel] || x.channel, fields: [
    { k: "text", label: "Post", type: "area", rows: 5 },
    { k: "hashtags", label: "Hashtags (one per line)", type: "lines" }
  ] },
  { key: "adVariations", n: 5, title: "Ad variations", kind: "rows", itemTitle: (x, i) => "Ad " + (i + 1) + (x.angle ? ": " + x.angle : ""), fields: [
    { k: "angle", label: "Angle", type: "text" },
    { k: "headline", label: "Headline", type: "text" },
    { k: "primaryText", label: "Primary text", type: "area", rows: 3 },
    { k: "description", label: "Description", type: "text" }
  ] },
  { key: "cta", n: 6, title: "Calls to action", kind: "rows", itemTitle: (x, i) => "Option " + (i + 1), fields: [
    { k: "text", label: "Text", type: "text" },
    { k: "button", label: "Button", type: "text" }
  ] },
  { key: "landingPage", n: 7, title: "Landing page", fields: [
    { k: "headline", label: "Headline", type: "text" },
    { k: "subheadline", label: "Subheadline", type: "area", rows: 2 },
    { k: "benefits", label: "Benefit blocks", type: "rows", fields: [{ k: "title", label: "Title", type: "text" }, { k: "text", label: "Text", type: "area", rows: 2 }] },
    { k: "proof", label: "Proof (one per line)", type: "lines" },
    { k: "faq", label: "FAQ", type: "rows", fields: [{ k: "q", label: "Question", type: "text" }, { k: "a", label: "Answer", type: "area", rows: 2 }] },
    { k: "cta", label: "Call to action", type: "text" }
  ] },
  { key: "email", n: 8, title: "Email", fields: [
    { k: "subjects", label: "Subject lines (2, one per line)", type: "lines" },
    { k: "preview", label: "Preview text", type: "text" },
    { k: "body", label: "Body", type: "area", rows: 10 },
    { k: "cta", label: "Call to action", type: "text" }
  ] },
  { key: "googleBusinessPost", n: 9, title: "Google Business post", fields: [
    { k: "text", label: "Post text (at most 1500 characters)", type: "area", rows: 6 },
    { k: "ctaType", label: "Button", type: "select", options: ["BOOK", "ORDER", "SHOP", "LEARN_MORE", "SIGN_UP", "CALL"].map((x) => [x, x]) }
  ] }
];

const toLines = (a) => (Array.isArray(a) ? a.join("\n") : "");
const fromLines = (s) => String(s || "").split("\n").map((x) => x.trim()).filter(Boolean);

/* ---------- the module ---------- */

export function createCampaigns(ctx) {
  const { h, clear, api, when } = ctx;
  const cache = {};
  let promptDef = null;
  let schema = null;
  let visualsPrompt = null;
  let platforms = null;
  const vis = createVisualsUi(ctx);

  function entry(id) {
    if (!cache[id]) {
      cache[id] = { loaded: false, loading: false, list: [], saved: {}, view: null, working: null, dirty: false, isNew: false, showForm: false, form: null,
        building: false, steps: [], error: null, errors: null, msg: null, editing: {}, regen: {}, cardMsg: {},
        vbuilding: false, vsteps: [], verror: null, verrors: null, vedit: {}, vconfirm: false, opening: {} };
      try {
        const raw = localStorage.getItem(DRAFT_PREFIX + id);
        const d = raw && JSON.parse(raw);
        if (d && d.doc) {
          cache[id].working = d.doc;
          cache[id].dirty = true;
          cache[id].isNew = !!d.isNew;
          cache[id].view = d.doc.campaignId;
        }
      } catch (e) {}
    }
    return cache[id];
  }

  function keepDraft(id) {
    const e = entry(id);
    try {
      if (e.working && e.dirty) localStorage.setItem(DRAFT_PREFIX + id, JSON.stringify({ at: new Date().toISOString(), isNew: e.isNew, doc: e.working }));
      else localStorage.removeItem(DRAFT_PREFIX + id);
    } catch (err) {}
  }

  async function getSchema() {
    if (!schema) {
      const r = await fetch(VAULT + "/schemas/campaign", { credentials: "same-origin" });
      if (!r.ok) throw new Error("Could not load the campaign schema.");
      schema = await r.json();
    }
    return schema;
  }
  async function getPrompt() {
    if (!promptDef) {
      const r = await fetch(PROMPT_URL, { credentials: "same-origin" });
      if (!r.ok) throw new Error("Could not load the campaign prompt.");
      promptDef = await r.json();
    }
    return promptDef;
  }

  async function getVisualsDefs() {
    if (!visualsPrompt || !platforms) {
      const [a, b] = await Promise.all([fetch(VISUALS_PROMPT_URL, { credentials: "same-origin" }), fetch(PLATFORMS_URL, { credentials: "same-origin" })]);
      if (!a.ok || !b.ok) throw new Error("Could not load the Visual Pack prompt or the platform sizes.");
      visualsPrompt = await a.json();
      platforms = await b.json();
    }
    return { prompt: visualsPrompt, platforms };
  }

  function load(id, force) {
    const e = entry(id);
    if ((e.loaded && !force) || e.loading) return;
    e.loading = true;
    api("/admin/campaigns/" + encodeURIComponent(id)).then((r) => {
      e.loading = false;
      if (r.ok && r.d) {
        e.loaded = true;
        e.list = r.d.campaigns || [];
        if (!e.view && e.list.length) e.view = e.list[0].campaignId;
      } else e.error = "Could not load saved campaigns.";
      ctx.rerender(id);
    });
  }

  function openSaved(id, campaignId) {
    const e = entry(id);
    if (e.working && e.dirty && e.working.campaignId !== campaignId) {
      e.msg = { cls: "err", text: "Save or undo the changes to this campaign before opening another one." };
      ctx.rerender(id);
      return;
    }
    if (e.working && !e.dirty && e.working.campaignId !== campaignId) e.working = null;
    e.view = campaignId;
    e.msg = null;
    e.editing = {};
    e.cardMsg = {};
    if (e.working && e.working.campaignId === campaignId) { ctx.rerender(id); return; }
    if (e.saved[campaignId]) { ctx.rerender(id); return; }
    /* G1 fix: renderTab calls this while the campaign is loading, and the rerender below calls
       renderTab again. Without this guard every render started a new request (hundreds per
       second until the first answer arrived). */
    if (e.opening[campaignId]) return;
    e.opening[campaignId] = true;
    api("/admin/campaign/" + encodeURIComponent(id) + "/" + encodeURIComponent(campaignId)).then((r) => {
      delete e.opening[campaignId];
      if (r.ok && r.d) e.saved[campaignId] = r.d.campaign;
      ctx.rerender(id);
    });
    ctx.rerender(id);
  }

  function current(e) {
    if (e.working && e.working.campaignId === e.view) return e.working;
    return e.saved[e.view] || null;
  }

  /* Edits always happen on a working copy of the campaign shown. */
  function editable(e) {
    const doc = current(e);
    if (doc && doc !== e.working) {
      e.working = JSON.parse(JSON.stringify(doc));
      e.isNew = false;
    }
    return e.working;
  }

  /* ----- generating ----- */

  function step(e, id, text, state) {
    const last = e.steps[e.steps.length - 1];
    if (last && last.state === "run") last.state = "done";
    if (text) e.steps.push({ text, state: state || "run" });
    ctx.rerender(id);
  }

  function promptVars(c, d, brain, f, prompt) {
    const profile = (d && d.intake && d.intake.profile) || {};
    return {
      COMPANY: profile.companyName || c.name,
      LOCATION: profile.location || "",
      NAME: f.name,
      MONTH: f.month,
      MONTH_LABEL: monthLabel(f.month, "en"),
      GOAL: prompt.goals[f.goal] || f.goal,
      OFFER: f.offer || "No specific offer this month: lead with the product itself.",
      CHANNELS: f.channels.join(", "),
      BRAIN_VERSION: String(brain.brainVersion),
      BRAIN_JSON: JSON.stringify(brain, null, 1)
    };
  }

  function systemFor(prompt, sch, f) {
    return fillTemplate(prompt.system.join("\n"), {
      LANGUAGE_RULE: prompt.languageRules[f.language] || prompt.languageRules.en,
      SCHEMA: JSON.stringify(campaignModelSchema(sch)),
      CHANNELS: f.channels.join(", ")
    });
  }

  async function generate(c, d, brain) {
    const id = c.id;
    const e = entry(id);
    if (e.building) return;
    const p = ctx.providerInfo(true);
    if (!p.key) { ctx.pointToSection2(); return; }
    const f = e.form;
    if (!f.channels.length) { e.error = "Pick at least one channel."; ctx.rerender(id); return; }
    e.building = true;
    e.error = null;
    e.errors = null;
    e.msg = null;
    e.steps = [];
    e.showForm = false;
    ctx.rerender(id);
    try {
      step(e, id, "Loading the prompt, the campaign schema and brain v" + brain.brainVersion);
      const [prompt, sch] = await Promise.all([getPrompt(), getSchema()]);
      const taken = e.list.map((x) => x.campaignId);
      const meta = { clientId: id, campaignId: campaignIdFor(f.month, f.language, taken), brainVersion: brain.brainVersion, name: f.name, month: f.month, goal: f.goal, language: f.language, channels: f.channels };
      const system = systemFor(prompt, sch, f);
      const userText = fillTemplate(prompt.user.join("\n"), promptVars(c, d, brain, f, prompt));
      const messages = [{ role: "user", content: userText }];
      const maxTokens = (prompt.maxTokens && prompt.maxTokens[p.provider]) || 8000;

      step(e, id, "Asking " + p.label + " for the concept and nine outputs (this can take a minute or two)");
      let reply = await callModel(p, system, messages, maxTokens);
      const check = (text) => {
        try {
          const out = normalizeCampaign(extractJson(text), meta, sch);
          const v = validate(sch, out.doc);
          const errs = (v.valid ? [] : v.errors).concat(out.problems);
          return { doc: out.doc, errs: errs.length ? errs : null };
        } catch (err) {
          return { doc: null, errs: [err.message] };
        }
      };
      let res = check(reply);
      if (res.errs) {
        step(e, id, "The first answer had " + res.errs.length + (res.errs.length === 1 ? " problem" : " problems") + ". Asking once more with the list");
        reply = await callModel(p, system, messages.concat([
          { role: "assistant", content: reply.slice(0, 60000) },
          { role: "user", content: fillTemplate(prompt.retry, { ERRORS: res.errs.slice(0, 30).map((x) => "- " + x).join("\n") }) }
        ]), maxTokens);
        res = check(reply);
      }
      if (res.errs) {
        e.errors = res.errs;
        throw new Error("The answer still did not match the campaign schema after one retry.");
      }
      step(e, id, "Campaign ready to review", "done");
      e.working = res.doc;
      e.isNew = true;
      e.dirty = true;
      e.view = res.doc.campaignId;
      e.editing = {};
      e.cardMsg = {};
      keepDraft(id);
    } catch (err) {
      const last = e.steps[e.steps.length - 1];
      if (last) last.state = "fail";
      e.error = err.message || "Something went wrong.";
    }
    e.building = false;
    ctx.rerender(id);
    if (!e.error && f.visuals) await makeVisuals(c, d, brain);
  }

  async function regenerate(c, d, brain, key) {
    const id = c.id;
    const e = entry(id);
    const p = ctx.providerInfo(true);
    if (!p.key) { ctx.pointToSection2(); return; }
    const doc = editable(e);
    if (!doc || e.regen[key]) return;
    e.regen[key] = true;
    e.cardMsg[key] = null;
    ctx.rerender(id);
    try {
      const [prompt, sch] = await Promise.all([getPrompt(), getSchema()]);
      const f = { name: doc.name, month: doc.month, goal: doc.goal, language: doc.language, channels: doc.channels, offer: (doc.offer && doc.offer.terms) || "" };
      const part = { type: "object", additionalProperties: false, properties: { [key]: sch.properties[key] }, required: [key] };
      const userText = fillTemplate(prompt.user.join("\n"), promptVars(c, d, brain, f, prompt)).replace(/Write the full campaign now\. Reply with the JSON object only\.\s*$/, "") +
        "\n" + fillTemplate(prompt.regenerate.join("\n"), { CAMPAIGN_JSON: JSON.stringify(doc), KEY: key, PART_SCHEMA: JSON.stringify(part) });
      const reply = await callModel(p, systemFor(prompt, sch, f), [{ role: "user", content: userText }], 6000);
      const raw = extractJson(reply);
      const merged = normalizeCampaign(Object.assign({}, doc, { [key]: raw[key] }), { clientId: doc.clientId, campaignId: doc.campaignId, brainVersion: doc.brainVersion, name: doc.name, month: doc.month, goal: doc.goal, language: doc.language, channels: doc.channels }, sch);
      const v = validate(part, { [key]: merged.doc[key] });
      if (!v.valid || (key === "socialCopy" && merged.problems.length)) throw new Error("The new version did not fit: " + (v.errors || []).concat(merged.problems).slice(0, 4).join("; "));
      doc[key] = merged.doc[key];
      doc.status = (e.saved[doc.campaignId] && e.saved[doc.campaignId].status) || doc.status;
      e.dirty = true;
      keepDraft(id);
      e.cardMsg[key] = { cls: "ok", text: "New version written. Save to keep it." };
    } catch (err) {
      e.cardMsg[key] = { cls: "err", text: err.message || "Could not regenerate." };
    }
    e.regen[key] = false;
    ctx.rerender(id);
  }

  /* ----- step 2: Make visuals (V2 phase G1) ----- */

  function vstep(e, id, text, state) {
    const last = e.vsteps[e.vsteps.length - 1];
    if (last && last.state === "run") last.state = "done";
    if (text) e.vsteps.push({ text, state: state || "run" });
    ctx.rerender(id);
  }

  /* Writes the Visual Pack for the campaign shown (a new one, or one made before Part G). */
  async function makeVisuals(c, d, brain) {
    const id = c.id;
    const e = entry(id);
    if (e.vbuilding) return;
    const p = ctx.providerInfo(true);
    if (!p.key) { ctx.pointToSection2(); return; }
    const doc = editable(e);
    if (!doc) return;
    e.vbuilding = true;
    e.verror = null;
    e.verrors = null;
    e.vsteps = [];
    ctx.rerender(id);
    try {
      vstep(e, id, "Loading the Visual Pack prompt, the platform sizes and the brand kit");
      const [{ prompt, platforms: pf }, sch] = await Promise.all([getVisualsDefs(), getSchema()]);
      const kitS = vis.kitState(id);
      for (let i = 0; i < 40 && !kitS.loaded; i++) await new Promise((r) => setTimeout(r, 100));
      const kit = kitS.kit;
      const slots = buildSlots(doc, pf);
      const files = (d && d.files) || [];
      const photos = photoList(files, brain);
      const profile = (d && d.intake && d.intake.profile) || {};
      const brief = (s) => ({ id: s.id, output: s.output_key, placement: s.placement, size: s.width + " x " + s.height + " (" + s.ratio + ")", clear_zone: s.clear_zone, focus: s.focus, angle: s.angle, copy: s.copy });
      const system = fillTemplate(prompt.system.join("\n"), {
        LANGUAGE_RULE: prompt.languageRules[doc.language] || prompt.languageRules.en,
        SCHEMA: JSON.stringify(briefModelSchema(sch))
      });
      const userFor = (part) => fillTemplate(prompt.user.join("\n"), {
        COMPANY: profile.companyName || c.name,
        LOCATION: profile.location || "",
        NAME: doc.name,
        MONTH_LABEL: monthLabel(doc.month, "en"),
        GOAL: doc.goal,
        CONCEPT: doc.concept ? doc.concept.title + ". " + doc.concept.bigIdea + " " + doc.concept.keyMessage : "",
        OFFER: doc.offer ? doc.offer.framing + " " + doc.offer.terms : "",
        BRAND_KIT: kit ? kitPromptText(kit) : prompt.noKit,
        PHOTOS: photos.length ? photos.map((x) => "- " + x.fileId + ": " + (x.caption || x.name || "no caption") + (x.bestUse ? " (best use: " + x.bestUse + ")" : "")).join("\n") : prompt.noPhotos,
        BRAIN_VERSION: String(brain.brainVersion),
        BRAIN_JSON: JSON.stringify(brainForVisuals(brain), null, 1),
        BRIEFS_JSON: JSON.stringify(part.map(brief), null, 1)
      });
      /* G1 fix (live, 6 Oct 2026): one call for all 16 briefs ran past Cloudflare's 100 second
         limit on the relay (HTTP 524). The briefs are now asked for in small batches, each well
         under the limit, each with its own check and one retry. */
      const size = Math.max(1, prompt.batchSize || 4);
      const batchTokens = (prompt.batchMaxTokens && prompt.batchMaxTokens[p.provider]) || 6000;
      const nctx = { photoIds: photos.map((x) => x.fileId), language: doc.language, noTextSentence: prompt.noTextSentence, avoidDefault: prompt.avoidDefault };
      const transient = (err) => /HTTP (408|429|5\d\d)\b|Failed to fetch|NetworkError|network/i.test(String(err && err.message));
      const ask = async (msgs) => {
        try {
          return await callModel(p, system, msgs, batchTokens);
        } catch (err) {
          if (!transient(err)) throw err;
          await new Promise((r) => setTimeout(r, 3000));
          return await callModel(p, system, msgs, batchTokens);
        }
      };
      const batches = [];
      for (let i = 0; i < slots.length; i += size) batches.push(slots.slice(i, i + size));
      const all = [];

      for (let bi = 0; bi < batches.length; bi++) {
        const part = batches[bi];
        const from = bi * size + 1;
        const check = (text) => {
          try {
            const out = normalizeVisuals(extractJson(text), part, nctx);
            const errs = checkVisuals(sch, out.visuals).concat(out.problems);
            return { visuals: out.visuals, errs: errs.length ? errs : null };
          } catch (err) {
            return { visuals: null, errs: [err.message] };
          }
        };
        vstep(e, id, "Asking " + p.label + " for briefs " + from + " to " + (from + part.length - 1) + " of " + slots.length + (bi === 0 ? " (about half a minute per batch)" : ""));
        const messages = [{ role: "user", content: userFor(part) }];
        let reply = await ask(messages);
        let res = check(reply);
        if (res.errs) {
          vstep(e, id, "Briefs " + from + " to " + (from + part.length - 1) + ": the first answer had " + res.errs.length + (res.errs.length === 1 ? " problem" : " problems") + ". Asking once more with the list");
          reply = await ask(messages.concat([
            { role: "assistant", content: reply.slice(0, 60000) },
            { role: "user", content: fillTemplate(prompt.retry, { ERRORS: res.errs.slice(0, 30).map((x) => "- " + x).join("\n") }) }
          ]));
          res = check(reply);

        }
        if (res.errs) {
          e.verrors = res.errs;
          throw new Error("Briefs " + from + " to " + (from + part.length - 1) + " still did not pass the checks after one retry. Nothing was changed; try Make visuals again.");
        }
        all.push(...res.visuals);
      }
      const res = { visuals: all };
      const need = res.visuals.filter((v) => v.source === "client_photo" && !v.photo_ref).length;
      vstep(e, id, slots.length + " briefs ready" + (need ? ", " + need + " need a photo from the client" : "") + ". Save to keep them.", "done");
      const next = withVisuals(doc, res.visuals);
      Object.keys(doc).forEach((k) => delete doc[k]);
      Object.assign(doc, next);
      e.dirty = true;
      e.vedit = {};
      keepDraft(id);
    } catch (err) {
      const last = e.vsteps[e.vsteps.length - 1];
      if (last) last.state = "fail";
      e.verror = err.message || "Something went wrong.";
    }
    e.vbuilding = false;
    ctx.rerender(id);
  }

  /* ----- saving and status ----- */

  async function save(c) {
    const id = c.id;
    const e = entry(id);
    const doc = e.working;
    if (!doc) return;
    const sch = await getSchema();
    const v = validate(sch, doc);
    if (!v.valid) {
      e.msg = { cls: "err", text: "Fix these before saving: " + v.errors.slice(0, 6).join("; ") };
      ctx.rerender(id);
      return;
    }
    e.msg = { cls: "info", text: "Saving..." };
    ctx.rerender(id);
    const r = await api("/admin/campaign/" + encodeURIComponent(id), { method: "POST", body: { campaign: doc } });
    if (r.ok && r.d && r.d.campaign) {
      e.saved[doc.campaignId] = r.d.campaign;
      e.working = null;
      e.dirty = false;
      e.isNew = false;
      e.editing = {};
      e.vedit = {};
      if (!e.vbuilding && !e.verror) e.vsteps = [];
      keepDraft(id);
      e.loaded = false;
      load(id, true);
      e.view = doc.campaignId;
      e.msg = { cls: "ok", text: "Campaign saved. The client now sees: " + (r.d.statusLabel ? r.d.statusLabel.en : r.d.clientStatus) + "." };
      ctx.onSaved(id);
    } else {
      e.msg = { cls: "err", text: ((r.d && r.d.message && r.d.message.en) || "Could not save.") + (r.d && r.d.details ? " " + r.d.details.slice(0, 6).join("; ") : "") };
    }
    ctx.rerender(id);
  }

  async function setStatus(c, campaignId, status) {
    const id = c.id;
    const e = entry(id);
    const r = await api("/admin/campaign/" + encodeURIComponent(id) + "/" + encodeURIComponent(campaignId) + "/status", { method: "PATCH", body: { status } });
    if (r.ok && r.d) {
      if (e.saved[campaignId]) e.saved[campaignId].status = status;
      if (e.working && e.working.campaignId === campaignId) e.working.status = status;
      e.list.forEach((x) => { if (x.campaignId === campaignId) x.status = status; });
      e.msg = { cls: "ok", text: "The client now sees: " + (r.d.statusLabel ? r.d.statusLabel.en : r.d.clientStatus) + "." };
      ctx.onSaved(id);
    } else e.msg = { cls: "err", text: "Could not change the status. Try again." };
    ctx.rerender(id);
  }

  function discard(id) {
    const e = entry(id);
    const wasNew = e.isNew;
    e.working = null;
    e.dirty = false;
    e.isNew = false;
    e.editing = {};
    e.msg = null;
    keepDraft(id);
    if (wasNew) e.view = e.list.length ? e.list[0].campaignId : null;
    ctx.rerender(id);
  }

  function download(name, text, type) {
    const blob = new Blob([text], { type });
    const a = h("a", { href: URL.createObjectURL(blob), download: name });
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }

  function copy(text, done) {
    const fallback = () => {
      const ta = h("textarea", { style: "position:fixed;left:-9999px;top:0" });
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand("copy"); } catch (e) {}
      ta.remove();
      done();
    };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, fallback);
    else fallback();
  }

  /* ----- rendering ----- */

  function inputFor(f, value, onChange) {
    const idp = "gcc-" + Math.random().toString(36).slice(2, 9);
    let el;
    if (f.type === "select") {
      el = h("select", { id: idp }, f.options.map((o) => h("option", { value: o[0], selected: value === o[0] }, o[1])));
      el.addEventListener("change", () => onChange(el.value));
    } else if (f.type === "text") {
      el = h("input", { id: idp, type: "text" });
      el.value = value == null ? "" : String(value);
      el.addEventListener("input", () => onChange(el.value));
    } else {
      const lines = f.type === "lines";
      el = h("textarea", { id: idp, class: "gc-ta", rows: String(f.rows || (lines ? Math.min(8, Math.max(2, (value || []).length + 1)) : 3)) });
      el.value = lines ? toLines(value) : value == null ? "" : String(value);
      el.addEventListener("input", () => onChange(lines ? fromLines(el.value) : el.value));
    }
    return h("div", { class: "gc-ed" }, h("label", { for: idp, text: f.label }), el);
  }

  function fieldsInto(box, obj, fields, onEdit) {
    fields.forEach((f) => {
      if (f.type === "rows") {
        const list = Array.isArray(obj[f.k]) ? obj[f.k] : (obj[f.k] = []);
        box.appendChild(h("div", { class: "gc-label", text: f.label }));
        list.forEach((item) => {
          const row = h("div", { class: "gc-row-fields gc-row-ed" });
          fieldsInto(row, item, f.fields, onEdit);
          box.appendChild(row);
        });
      } else box.appendChild(inputFor(f, obj[f.k], (v) => { obj[f.k] = v; onEdit(); }));
    });
  }

  function readView(key, v) {
    const box = h("div", { class: "gc-read" });
    const para = (t, cls) => h("p", { class: cls || null, text: t == null ? "" : String(t) });
    if (!v) return box;
    if (key === "concept") {
      box.appendChild(h("div", { class: "gc-read-title", text: v.title }));
      box.appendChild(para("Big idea: " + pad(v.bigIdea)));
      box.appendChild(para("Key message: " + pad(v.keyMessage)));
      box.appendChild(para("Why now: " + pad(v.whyNow), "gc-muted"));
    } else if (key === "hook") {
      box.appendChild(h("ol", null, v.map((x) => h("li", { text: x }))));
    } else if (key === "socialCopy") {
      v.forEach((s) => {
        box.appendChild(h("div", { class: "gc-read-sub", text: CHANNEL_LABEL[s.channel] || s.channel }));
        box.appendChild(para(s.text));
        if (s.hashtags && s.hashtags.length) box.appendChild(para(s.hashtags.join(" "), "gc-muted"));
      });
    } else if (key === "adVariations") {
      v.forEach((a, i) => {
        box.appendChild(h("div", { class: "gc-read-sub", text: "Ad " + (i + 1) + ": " + pad(a.angle) }));
        box.appendChild(para("Headline: " + pad(a.headline)));
        box.appendChild(para(a.primaryText));
        box.appendChild(para("Description: " + pad(a.description), "gc-muted"));
      });
    } else if (key === "googleBusinessPost") {
      box.appendChild(para(v.text));
      box.appendChild(para("Button: " + pad(v.ctaType) + " · " + String(v.text || "").length + " of 1500 characters", "gc-muted"));
    } else box.appendChild(para(cardText(key, v)));
    return box;
  }

  function formBlock(c, d, brain, e) {
    const profile = (d && d.intake && d.intake.profile) || {};
    const company = profile.companyName || c.name;
    if (!e.form) {
      const now = new Date();
      const month = now.getFullYear() + "-" + String(now.getMonth() + 1).padStart(2, "0");
      const offers = brain.offers || [];
      const lang0 = languageFromBrain(brain);
      e.form = {
        month,
        name: defaultName(month, company, lang0),
        nameTouched: false,
        goal: "sales",
        offerPick: offers.length ? "0" : "custom",
        offer: offers.length ? [offers[0].name, offers[0].terms, offers[0].validUntil ? "valid until " + offers[0].validUntil : ""].filter(Boolean).join(". ") : "",
        language: lang0,
        channels: ["instagram", "facebook", "google_business"],
        visuals: true
      };
    }
    const f = e.form;
    const box = h("form", { class: "gc-box gc-cform", novalidate: true });
    box.appendChild(h("div", { class: "gc-bh" }, "New campaign", h("span", { text: "From brain v" + brain.brainVersion })));
    const grid = h("div", { class: "gc-cgrid" });

    const nameIn = h("input", { type: "text", id: "gccName", maxlength: "200" });
    nameIn.value = f.name;
    nameIn.addEventListener("input", () => { f.name = nameIn.value; f.nameTouched = true; });
    const monthIn = h("input", { type: "month", id: "gccMonth" });
    monthIn.value = f.month;
    monthIn.addEventListener("change", () => {
      if (/^\d{4}-\d{2}$/.test(monthIn.value)) {
        f.month = monthIn.value;
        if (!f.nameTouched) { f.name = defaultName(f.month, company, f.language); nameIn.value = f.name; }
      }
    });
    const goalIn = h("select", { id: "gccGoal" }, GOALS.map((g) => h("option", { value: g[0], selected: f.goal === g[0] }, g[1])));
    goalIn.addEventListener("change", () => { f.goal = goalIn.value; });
    const offers = brain.offers || [];
    const offerPick = h("select", { id: "gccOfferPick" },
      offers.map((o, i) => h("option", { value: String(i), selected: f.offerPick === String(i) }, o.name)),
      h("option", { value: "custom", selected: f.offerPick === "custom" }, "Type my own"),
      h("option", { value: "none", selected: f.offerPick === "none" }, "No offer this month"));
    const offerText = h("textarea", { id: "gccOffer", class: "gc-ta", rows: "2" });
    offerText.value = f.offer;
    offerText.addEventListener("input", () => { f.offer = offerText.value; f.offerPick = "custom"; offerPick.value = "custom"; });
    offerPick.addEventListener("change", () => {
      f.offerPick = offerPick.value;
      if (offerPick.value === "none") f.offer = "";
      else if (offerPick.value !== "custom") {
        const o = offers[+offerPick.value];
        f.offer = [o.name, o.terms, o.validUntil ? "valid until " + o.validUntil : ""].filter(Boolean).join(". ");
      }
      offerText.value = f.offer;
    });
    const langIn = h("select", { id: "gccLang" }, LANGS.map((l) => h("option", { value: l[0], selected: f.language === l[0] }, l[1])));
    langIn.addEventListener("change", () => {
      f.language = langIn.value;
      if (!f.nameTouched) { f.name = defaultName(f.month, company, f.language); nameIn.value = f.name; }
    });

    const lab = (forId, t) => h("label", { for: forId, text: t });
    grid.appendChild(h("div", { class: "gc-ed wide" }, lab("gccName", "Campaign name"), nameIn));
    grid.appendChild(h("div", { class: "gc-ed" }, lab("gccMonth", "Month"), monthIn));
    grid.appendChild(h("div", { class: "gc-ed" }, lab("gccGoal", "Goal"), goalIn));
    grid.appendChild(h("div", { class: "gc-ed" }, lab("gccLang", "Language (from the brain, can be changed)"), langIn));
    grid.appendChild(h("div", { class: "gc-ed wide" }, lab("gccOfferPick", "Offer to push"), offerPick, offerText));
    const chBox = h("fieldset", { class: "gc-ed wide gc-channels" }, h("legend", { text: "Channels" }));
    CHANNELS.forEach((ch) => {
      const cb = h("input", { type: "checkbox", id: "gccCh-" + ch[0], checked: f.channels.includes(ch[0]) });
      cb.addEventListener("change", () => {
        const set = new Set(f.channels);
        if (cb.checked) set.add(ch[0]); else set.delete(ch[0]);
        f.channels = CHANNELS.map((x) => x[0]).filter((x) => set.has(x));
      });
      chBox.appendChild(h("label", { for: "gccCh-" + ch[0], class: "gc-check" }, cb, ch[1]));
    });
    grid.appendChild(chBox);
    const visCb = h("input", { type: "checkbox", id: "gccVisuals", checked: f.visuals !== false });
    visCb.addEventListener("change", () => { f.visuals = visCb.checked; });
    grid.appendChild(h("div", { class: "gc-ed wide" }, h("label", { for: "gccVisuals", class: "gc-check" }, visCb, "Then make visuals: an image brief for every output at its platform size (step 2)")));
    box.appendChild(grid);

    const p = ctx.providerInfo();
    const go = h("button", { type: "submit", class: "gc-brain-btn" }, "Generate campaign");
    const actions = h("div", { class: "gc-brain-tools" }, go);
    if (e.list.length || e.working) actions.appendChild(h("button", { type: "button", class: "btn-ghost", on: { click: () => { e.showForm = false; ctx.rerender(c.id); } } }, "Cancel"));
    box.appendChild(actions);
    box.appendChild(h("div", { class: "gc-meta", text: p.hasKey ? "Uses " + p.label + (p.model ? " · " + p.model : "") + " with your key from section 2. One call writes the concept and all nine outputs; step 2 is a second call for the visuals." : "Add your " + p.label + " key in section 2 first." }));
    box.addEventListener("submit", (ev) => {
      ev.preventDefault();
      if (!f.name.trim()) f.name = defaultName(f.month, company, f.language);
      if (!p.hasKey) { ctx.pointToSection2(); return; }
      if (e.dirty && e.isNew && e.working) {
        e.msg = { cls: "err", text: "You have an unsaved campaign. Save or discard it first." };
        e.showForm = false;
        ctx.rerender(c.id);
        return;
      }
      generate(c, d, brain);
    });
    return box;
  }

  function renderTab(pane, c, d, brain) {
    const e = entry(c.id);
    load(c.id);

    if (!brain) {
      pane.appendChild(h("div", { class: "gc-soon" }, h("b", { text: "Build and save a Business Brain first. " }), "Every campaign is written from the latest saved brain."));
      return;
    }

    if (e.building || e.steps.length) {
      const box = h("div", { class: "gc-box" }, h("div", { class: "gc-bh" }, e.building ? "Writing the campaign" : e.error ? "Generation stopped" : "Generation finished"));
      const ol = h("ol", { class: "gc-steps" });
      e.steps.forEach((s) => ol.appendChild(h("li", { class: "gc-step " + s.state }, s.state === "run" ? h("span", { class: "spin" }) : null, s.text)));
      box.appendChild(ol);
      if (e.error) box.appendChild(h("div", { class: "gc-msg err", text: e.error }));
      if (e.errors) box.appendChild(h("div", { class: "gc-files" }, e.errors.slice(0, 20).map((x) => h("div", { class: "gc-meta", text: x }))));
      if (!e.building) box.appendChild(h("button", { type: "button", class: "gc-link", on: { click: () => { e.steps = []; e.error = null; e.errors = null; ctx.rerender(c.id); } } }, "Hide this"));
      pane.appendChild(box);
      if (e.building) return;
    } else if (e.error) pane.appendChild(h("div", { class: "gc-msg err", text: e.error }));

    if (!e.loaded && !e.working) {
      pane.appendChild(h("div", { class: "gc-msg info" }, h("span", { class: "spin" }), "Loading campaigns..."));
      return;
    }

    /* Picker and New campaign */
    const opts = [];
    if (e.working && e.isNew) opts.push([e.working.campaignId, "Unsaved: " + e.working.name]);
    e.list.forEach((x) => opts.push([x.campaignId, x.name + " · " + (LANG_LABEL[x.language] || x.language) + " · " + (x.status === "delivered" ? "delivered" : "in production") + " · " + when(x.updatedAt)]));
    const bar = h("div", { class: "gc-bar" });
    if (opts.length) {
      if (!e.view || !opts.some((o) => o[0] === e.view)) e.view = opts[0][0];
      const sel = h("select", { id: "gcCampaignPick", class: "gc-select" }, opts.map((o) => h("option", { value: o[0], selected: o[0] === e.view }, o[1])));
      sel.addEventListener("change", () => openSaved(c.id, sel.value));
      bar.appendChild(h("div", { class: "gc-verpick" }, h("label", { for: "gcCampaignPick", class: "gc-label", text: "Campaign" }), sel));
    } else bar.appendChild(h("div", { class: "gc-label", text: "No campaigns yet" }));
    if (!e.showForm && opts.length) bar.appendChild(h("button", { type: "button", class: "btn-copy", on: { click: () => { e.showForm = true; ctx.rerender(c.id); } } }, "+ New campaign"));
    pane.appendChild(bar);

    if (e.showForm || !opts.length) {
      pane.appendChild(formBlock(c, d, brain, e));
      if (!opts.length) return;
    }

    const doc = current(e);
    if (!doc) {
      if (!e.saved[e.view]) openSaved(c.id, e.view);
      pane.appendChild(h("div", { class: "gc-msg info" }, h("span", { class: "spin" }), "Loading the campaign..."));
      return;
    }

    const hits = findAvoidWords(doc, (brain.words && brain.words.avoid) || []);
    const hdr = h("div", { class: "gc-brain-hdr" });
    function fillHeader() {
      clear(hdr);
      const status = e.isNew && e.working === doc ? "Not saved yet" : doc.status === "delivered" ? "Delivered" : "In production";
      hdr.appendChild(h("div", { class: "gc-camp-title" },
        h("h4", { text: doc.name }),
        h("span", { class: "gc-badge " + (doc.status === "delivered" ? "ok" : status === "Not saved yet" ? "warn" : ""), text: status })));
      hdr.appendChild(h("div", { class: "gc-meta", text: [monthLabel(doc.month, "en"), "Goal: " + doc.goal, LANG_LABEL[doc.language] || doc.language, (doc.channels || []).map((x) => CHANNEL_LABEL[x] || x).join(", "), "Brain v" + doc.brainVersion, doc.campaignId].join(" · ") }));
      const tools = h("div", { class: "gc-brain-tools" });
      const editingThis = e.working && e.working.campaignId === doc.campaignId && e.dirty;
      if (editingThis) {
        tools.appendChild(h("button", { type: "button", class: "gc-brain-btn", on: { click: () => save(c) } }, e.isNew ? "Save campaign" : "Save changes"));
        tools.appendChild(h("button", { type: "button", class: "btn-ghost", on: { click: () => discard(c.id) } }, e.isNew ? "Discard" : "Undo changes"));
      } else if (doc.status !== "delivered") {
        tools.appendChild(h("button", { type: "button", class: "gc-brain-btn", on: { click: () => setStatus(c, doc.campaignId, "delivered") } }, "Mark delivered"));
      } else {
        tools.appendChild(h("button", { type: "button", class: "btn-ghost", on: { click: () => setStatus(c, doc.campaignId, "in_production") } }, "Back to in production"));
      }
      const slug = String(doc.campaignId);
      const company = ((d && d.intake && d.intake.profile) || {}).companyName || c.name;
      tools.appendChild(h("button", { type: "button", class: "gc-link", on: { click: () => download("campaign-" + slug + ".json", JSON.stringify(doc, null, 2), "application/json") } }, "Export JSON"));
      tools.appendChild(h("button", { type: "button", class: "gc-link", on: { click: () => download("campaign-" + slug + ".html", campaignHtml(doc, company), "text/html") } }, "Export HTML"));
      hdr.appendChild(tools);
      const n = Object.keys(hits).length;
      if (n) hdr.appendChild(h("div", { class: "gc-msg err", text: "Words to avoid found in " + n + (n === 1 ? " output" : " outputs") + ": " + Object.keys(hits).map((k) => k + " (" + hits[k].join(", ") + ")").join("; ") + ". Edit or regenerate those cards." }));
      else hdr.appendChild(h("div", { class: "gc-meta", text: (brain.words && brain.words.avoid && brain.words.avoid.length) ? "Checked: none of the brain's words to avoid appear." : "The brain has no words to avoid listed." }));
      if (e.msg) hdr.appendChild(h("div", { class: "gc-msg " + e.msg.cls, role: "status", text: e.msg.text }));
    }
    fillHeader();
    pane.appendChild(hdr);

    /* Visual Pack (V2 phase G1): brand kit, Make or Add visuals, progress and the finished images. */
    const savedDoc = !(e.isNew && e.working === doc) ? e.saved[doc.campaignId] || (doc !== e.working ? doc : null) : null;
    const savedCampaignId = savedDoc ? doc.campaignId : null;
    const savedVisualIds = new Set(((savedDoc && savedDoc.visuals) || []).map((v) => v.id));
    const vbox = h("div", { class: "gc-box gv-pack" });
    const hasVisuals = Array.isArray(doc.visuals) && doc.visuals.length > 0;
    vbox.appendChild(h("div", { class: "gc-bh" }, "Visual Pack", h("span", { text: hasVisuals ? "campaign-2 · made " + when(doc.visualsMadeAt) : doc.schemaVersion === "campaign-1" && savedDoc ? "Made before Part G: no visuals yet" : "No visuals yet" })));
    vis.renderKit(vbox, c.id);
    if (e.vbuilding || e.vsteps.length) {
      const ol = h("ol", { class: "gc-steps" });
      e.vsteps.forEach((s) => ol.appendChild(h("li", { class: "gc-step " + s.state }, s.state === "run" ? h("span", { class: "spin" }) : null, s.text)));
      vbox.appendChild(ol);
      if (e.verror) vbox.appendChild(h("div", { class: "gc-msg err", text: e.verror }));
      if (e.verrors) vbox.appendChild(h("div", { class: "gc-files" }, e.verrors.slice(0, 20).map((x) => h("div", { class: "gc-meta", text: x }))));
      if (!e.vbuilding) vbox.appendChild(h("button", { type: "button", class: "gc-link", on: { click: () => { e.vsteps = []; e.verror = null; e.verrors = null; ctx.rerender(c.id); } } }, "Hide this"));
    }
    if (!e.vbuilding) {
      const pinfo = ctx.providerInfo();
      const label = hasVisuals ? (e.vconfirm ? "Yes, write new briefs" : "Remake visuals") : savedDoc && doc.schemaVersion !== "campaign-2" ? "Add visuals" : "Make visuals";
      const vtools = h("div", { class: "gc-brain-tools" },
        h("button", { type: "button", class: hasVisuals && !e.vconfirm ? "btn-ghost" : "gc-brain-btn", on: { click: () => {
          /* Remaking asks for a second click instead of a browser dialog. */
          if (hasVisuals && !e.vconfirm) { e.vconfirm = true; ctx.rerender(c.id); return; }
          e.vconfirm = false;
          makeVisuals(c, d, brain);
        } } }, label));
      if (e.vconfirm) vtools.appendChild(h("button", { type: "button", class: "gc-link", on: { click: () => { e.vconfirm = false; ctx.rerender(c.id); } } }, "Keep these"));
      if (e.vconfirm) vbox.appendChild(h("div", { class: "gc-msg info", text: "A new Visual Pack replaces the current briefs when you save. Attached images stay attached." }));
      vtools.appendChild(h("span", { class: "gc-meta", text: pinfo.hasKey ? "Uses " + pinfo.label + " with your key from section 2." : "Add your " + pinfo.label + " key in section 2 first." }));
      vbox.appendChild(vtools);
    }
    if (hasVisuals) vis.renderStrip(vbox, doc, c.id, savedCampaignId);
    pane.appendChild(vbox);

    const list = h("div", { class: "gc-cards one" });
    CARDS.forEach((card) => {
      const val = doc[card.key];
      const head = h("div", { class: "gc-card-head" }, h("h4", { text: (card.n ? card.n + ". " : "") + card.title }));
      const actions = h("div", { class: "gc-card-actions" });
      const msgEl = h("div", { class: "gc-meta", role: "status" });
      if (e.regen[card.key]) actions.appendChild(h("span", { class: "gc-meta" }, h("span", { class: "spin" }), "Rewriting..."));
      else {
        actions.appendChild(h("button", { type: "button", class: "gc-link", on: { click: () => regenerate(c, d, brain, card.key) } }, "Regenerate"));
        actions.appendChild(h("button", { type: "button", class: "gc-link", on: { click: () => copy(cardText(card.key, doc[card.key]), () => { msgEl.textContent = "Copied."; }) } }, "Copy"));
        actions.appendChild(h("button", { type: "button", class: "gc-link", on: { click: () => { editable(e); e.editing[card.key] = !e.editing[card.key]; ctx.rerender(c.id); } } }, e.editing[card.key] ? "Done" : "Edit"));
      }
      if (card.key === "shortVideo") {
        /* V2 phase G1: the video goes to ScriptForge for one of the two generators it offers. */
        actions.appendChild(h("button", { type: "button", class: "btn-copy gc-send", title: "Scenes and B-roll", on: { click: () => ctx.sendToScriptForge(doc.shortVideo.script, "veo") } }, "Send to ScriptForge: Veo 3.1"));
        actions.appendChild(h("button", { type: "button", class: "btn-copy gc-send", title: "Talking avatar, founder voice", on: { click: () => ctx.sendToScriptForge(doc.shortVideo.script, "heygen") } }, "Send to ScriptForge: HeyGen"));
      }
      head.appendChild(actions);
      const body = h("div", { class: "gc-card-body" });
      if (e.editing[card.key]) {
        const target = doc;
        const onEdit = () => {
          const first = !e.dirty;
          e.dirty = true;
          keepDraft(c.id);
          if (first) fillHeader();
        };
        if (card.kind === "lines") body.appendChild(inputFor({ label: card.label, type: "lines" }, target[card.key], (v) => { target[card.key] = v; onEdit(); }));
        else if (card.kind === "rows") (target[card.key] || []).forEach((item, i) => {
          const row = h("div", { class: "gc-row-ed" }, h("div", { class: "gc-row-title", text: card.itemTitle(item, i) }));
          const fields = h("div", { class: "gc-row-fields" });
          fieldsInto(fields, item, card.fields, onEdit);
          row.appendChild(fields);
          body.appendChild(row);
        });
        else fieldsInto(body, target[card.key] || (target[card.key] = {}), card.fields, onEdit);
      } else body.appendChild(readView(card.key, val));
      const briefs = briefsFor(doc, card.key);
      if (briefs.length) {
        vis.renderBriefs(body, briefs, {
          clientId: c.id,
          campaignId: savedCampaignId,
          savedVisualIds,
          files: (d && d.files) || [],
          editing: e.vedit,
          copy,
          toggleEdit: (vid) => {
            const w = editable(e);
            if (w !== doc) { e.vedit = {}; e.vedit[vid] = true; ctx.rerender(c.id); return; }
            e.vedit[vid] = !e.vedit[vid];
            ctx.rerender(c.id);
          },
          onEdit: () => {
            const first = !e.dirty;
            e.dirty = true;
            keepDraft(c.id);
            if (first) fillHeader();
          }
        });
      }
      if (hits[card.key]) body.appendChild(h("div", { class: "gc-msg err", text: "Avoid: " + hits[card.key].join(", ") }));
      if (e.cardMsg[card.key]) body.appendChild(h("div", { class: "gc-msg " + e.cardMsg[card.key].cls, text: e.cardMsg[card.key].text }));
      body.appendChild(msgEl);
      list.appendChild(h("section", { class: "gc-card wide" + (hits[card.key] ? " flagged" : "") }, head, body));
    });
    pane.appendChild(list);
  }

  return { renderTab, entry, load };
}
