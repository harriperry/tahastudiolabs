/* ScriptForge Growth Clients panel: the Business Brain (TAHA Growth Department V1, phase 4).
   Loaded by growth.js for the admin only, as an ES module.

   Build Business Brain, step by step:
   1. Takes the latest submitted intake and its files from the Brain Vault (already loaded by
      growth.js for the Intake tab).
   2. Reads uploaded documents (founder story, FAQs, reviews) into plain text here in the
      browser: .txt and .csv directly, .pdf with pdf.js, .docx with JSZip.
   3. If the provider chosen in section 2 can see pictures (Anthropic Claude, Google Gemini),
      shrinks each client picture to at most 1024 px and sends it along. Other providers get the
      file names only.
   4. Sends one structured prompt (assets/growth/brain.prompt.json) through ScriptForge's own
      /api/format relay, exactly the way ScriptForge sends a script today, using the provider,
      key and model from section 2. The key goes only there, never to the Brain Vault.
   5. Validates the answer against brain.schema.json. On failure it retries once with the list
      of errors, then shows the errors.
   6. Shows the brain as editable cards. Nothing is saved until Harry presses Save Brain, which
      posts it to the Vault as version N+1 and moves the client's status to Brain ready.
   An unsaved draft is kept in this browser (localStorage) so a reload does not throw away a
   paid generation. Saving or discarding clears it.

   No em-dashes: every text the model returns passes through stripDashes before Harry sees it,
   and the Vault strips them again on save. */
import { validate } from "./growth-validate.js?v=p5";

const VAULT = "/api/vault";
const PROMPT_URL = "/assets/growth/brain.prompt.json?v=p5";
const PDFJS = "/assets/vendor/pdfjs-4.10.38.min.js";
const PDFJS_WORKER = "/assets/vendor/pdfjs-4.10.38.worker.min.js";
const JSZIP = "/assets/vendor/jszip-3.10.1.min.js";
const VISION = { anthropic: true, gemini: true };
const SERVER_KEYS = ["schemaVersion", "clientId", "brainVersion", "builtFromIntakeVersion", "createdAt", "editedByHarry"];
const MAX_PICTURES = 20;
const MAX_DOC_CHARS = 20000;
const DRAFT_PREFIX = "taha-growth-brain-draft:";

/* ---------- small pure helpers (exported for tests) ---------- */

export function stripDashes(v) {
  if (typeof v === "string") return v.replace(/\s*\u2014\s*/g, ", ");
  if (Array.isArray(v)) return v.map(stripDashes);
  if (v && typeof v === "object") {
    const o = {};
    for (const k of Object.keys(v)) o[k] = stripDashes(v[k]);
    return o;
  }
  return v;
}

/* Pulls the JSON object out of a model reply, tolerating a code fence or a stray sentence. */
export function extractJson(text) {
  let t = String(text || "").trim();
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) t = fence[1].trim();
  const a = t.indexOf("{");
  const b = t.lastIndexOf("}");
  if (a === -1 || b <= a) throw new Error("The model did not return a JSON object.");
  return JSON.parse(t.slice(a, b + 1));
}

/* Trims what the schema would reject anyway (too long, too many, unknown keys) so a long but
   otherwise good answer does not fail on length alone. Type errors and missing keys are left
   for the validator and the retry. */
export function fitToSchema(schema, v) {
  if (!schema || v == null) return v;
  if (typeof v === "string" && schema.maxLength && v.length > schema.maxLength) {
    const cut = v.slice(0, schema.maxLength);
    const sp = cut.lastIndexOf(" ");
    return (sp > schema.maxLength * 0.8 ? cut.slice(0, sp) : cut).trim();
  }
  if (Array.isArray(v)) {
    let arr = v.map((x) => fitToSchema(schema.items, x));
    if (schema.maxItems && arr.length > schema.maxItems) arr = arr.slice(0, schema.maxItems);
    return arr;
  }
  if (typeof v === "object" && schema.properties) {
    const o = {};
    for (const k of Object.keys(v)) {
      if (schema.properties[k]) o[k] = fitToSchema(schema.properties[k], v[k]);
      else if (schema.additionalProperties !== false) o[k] = v[k];
    }
    return o;
  }
  return v;
}

function uniq(list) {
  const seen = new Set();
  const out = [];
  for (const x of list) {
    const s = String(x || "").trim();
    const k = s.toLowerCase();
    if (!s || seen.has(k)) continue;
    seen.add(k);
    out.push(s);
  }
  return out;
}

/* Turns the model's object into a full brain document ready to validate. */
export function normalizeBrain(raw, ctx) {
  const doc = stripDashes(Object.assign({}, raw));
  for (const k of SERVER_KEYS) delete doc[k];
  const intakeWords = (ctx.intake && ctx.intake.profile && ctx.intake.profile.brandWords) || {};
  doc.words = doc.words && typeof doc.words === "object" ? doc.words : { use: [], avoid: [] };
  doc.words.use = uniq([].concat(intakeWords.use || [], Array.isArray(doc.words.use) ? doc.words.use : []));
  doc.words.avoid = uniq([].concat(intakeWords.avoid || [], Array.isArray(doc.words.avoid) ? doc.words.avoid : []));
  if (Array.isArray(doc.imageNotes)) {
    const ok = new Set(ctx.pictureIds || []);
    const seen = new Set();
    doc.imageNotes = doc.imageNotes.filter((n) => n && ok.has(n.fileId) && !seen.has(n.fileId) && seen.add(n.fileId));
  }
  if (!Array.isArray(doc.languages) || !doc.languages.length) doc.languages = ctx.languages;
  const full = Object.assign(
    {
      schemaVersion: "brain-1",
      clientId: ctx.clientId,
      brainVersion: ctx.nextVersion,
      builtFromIntakeVersion: ctx.intakeVersion,
      createdAt: new Date().toISOString()
    },
    doc,
    { editedByHarry: false }
  );
  return fitToSchema(ctx.schema, full);
}

export function languagesFor(campaignLanguage) {
  if (campaignLanguage === "sv") return ["sv"];
  if (campaignLanguage === "both") return ["sv", "en"];
  return ["en"];
}

/* The part of brain.schema.json the model writes (server-owned keys removed). */
export function modelSchema(schema) {
  const s = JSON.parse(JSON.stringify(schema));
  for (const k of SERVER_KEYS) delete s.properties[k];
  s.required = s.required.filter((k) => !SERVER_KEYS.includes(k));
  delete s.$id;
  delete s.$schema;
  delete s.description;
  return s;
}

function fill(text, vars) {
  return String(text).replace(/\{\{([A-Z_]+)\}\}/g, (m, k) => (k in vars ? vars[k] : m));
}

/* One AI call through ScriptForge's own /api/format relay, exactly like a ScriptForge script
   run: provider, key and model come from section 2. Shared with growth-campaign.js. */
export async function callModel(p, system, messages, maxTokens) {
  const res = await fetch("/api/format", {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ provider: p.provider, apiKey: p.key, model: p.model, max_tokens: maxTokens, system, messages })
  });
  let data = null;
  try { data = await res.json(); } catch (err) {}
  if (!res.ok) throw new Error((data && data.error && data.error.message) || "The provider answered with HTTP " + res.status + ".");
  const text = ((data && data.content) || []).filter((b) => b.type === "text").map((b) => b.text).join("\n").trim();
  if (!text) throw new Error("The provider returned an empty answer.");
  return text;
}

export function fillTemplate(text, vars) {
  return String(text).replace(/\{\{([A-Z_]+)\}\}/g, (m, k) => (k in vars ? vars[k] : m));
}

/* ---------- reading files in the browser ---------- */

let jszipLoading = null;
function loadJsZip() {
  if (window.JSZip) return Promise.resolve(window.JSZip);
  if (!jszipLoading) {
    jszipLoading = new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = JSZIP;
      s.onload = () => resolve(window.JSZip);
      s.onerror = () => reject(new Error("Could not load the Word reader."));
      document.head.appendChild(s);
    });
  }
  return jszipLoading;
}

async function pdfText(buf) {
  const pdfjs = await import(PDFJS);
  pdfjs.GlobalWorkerOptions.workerSrc = PDFJS_WORKER;
  const pdf = await pdfjs.getDocument({ data: new Uint8Array(buf), isEvalSupported: false }).promise;
  const parts = [];
  for (let i = 1; i <= pdf.numPages && parts.join("\n").length < MAX_DOC_CHARS; i++) {
    const page = await pdf.getPage(i);
    const tc = await page.getTextContent();
    parts.push(tc.items.map((it) => (it.str || "") + (it.hasEOL ? "\n" : " ")).join(""));
  }
  return parts.join("\n\n");
}

async function docxText(buf) {
  const JSZip = await loadJsZip();
  const zip = await JSZip.loadAsync(buf);
  const f = zip.file("word/document.xml");
  if (!f) throw new Error("Not a Word document.");
  const xml = new DOMParser().parseFromString(await f.async("string"), "application/xml");
  const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
  return Array.from(xml.getElementsByTagNameNS(W, "p"))
    .map((p) => Array.from(p.getElementsByTagNameNS(W, "t")).map((t) => t.textContent).join(""))
    .filter((s) => s.trim())
    .join("\n\n");
}

async function readDocument(file) {
  const res = await fetch(file.url, { credentials: "same-origin" });
  if (!res.ok) throw new Error("download failed");
  const buf = await res.arrayBuffer();
  let text;
  if (file.mime === "application/pdf") text = await pdfText(buf);
  else if (/wordprocessingml/.test(file.mime)) text = await docxText(buf);
  else text = new TextDecoder("utf-8").decode(buf);
  text = String(text || "").replace(/\u0000/g, "").trim();
  return text.length > MAX_DOC_CHARS ? text.slice(0, MAX_DOC_CHARS) + " [cut]" : text;
}

async function shrinkPicture(file) {
  const res = await fetch(file.url, { credentials: "same-origin" });
  if (!res.ok) throw new Error("download failed");
  const bmp = await createImageBitmap(await res.blob());
  const scale = Math.min(1, 1024 / Math.max(bmp.width, bmp.height));
  const w = Math.max(1, Math.round(bmp.width * scale));
  const h = Math.max(1, Math.round(bmp.height * scale));
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  c.getContext("2d").drawImage(bmp, 0, 0, w, h);
  if (bmp.close) bmp.close();
  const blob = await new Promise((r) => c.toBlob(r, "image/jpeg", 0.82));
  const b64 = await new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(String(fr.result).split(",")[1]);
    fr.onerror = () => reject(new Error("read failed"));
    fr.readAsDataURL(blob);
  });
  return { media_type: "image/jpeg", data: b64 };
}

/* ---------- the editable cards ---------- */

const SOURCES = [["review", "Review"], ["faq", "FAQ"], ["founder", "Founder story"], ["usp", "USP"]];

const CARDS = [
  { key: "positioning", title: "Positioning", kind: "object", fields: [
    { k: "oneLiner", label: "One-liner", type: "area", rows: 2 },
    { k: "category", label: "Category", type: "text" },
    { k: "differentiators", label: "Differentiators (one per line)", type: "lines" }
  ] },
  { key: "personas", title: "Personas", kind: "rows", min: 1, max: 6, add: "Add persona", itemTitle: (x, i) => x.name || "Persona " + (i + 1),
    blank: () => ({ name: "", who: "", wants: "", fears: "", whereTheyAre: [] }), fields: [
    { k: "name", label: "Name", type: "text" },
    { k: "who", label: "Who they are", type: "area" },
    { k: "wants", label: "What they want", type: "area" },
    { k: "fears", label: "What worries them", type: "area" },
    { k: "whereTheyAre", label: "Where to reach them (one per line)", type: "lines" }
  ] },
  { key: "voice", title: "Voice rules", kind: "object", fields: [
    { k: "summary", label: "Summary", type: "area" },
    { k: "do", label: "Do (one per line)", type: "lines" },
    { k: "dont", label: "Don't (one per line)", type: "lines" },
    { k: "sampleLines", label: "Sample lines (one per line)", type: "lines" }
  ] },
  { key: "words", title: "Words to use and avoid", kind: "object", fields: [
    { k: "use", label: "Use (one per line)", type: "lines" },
    { k: "avoid", label: "Avoid (one per line)", type: "lines" }
  ] },
  { key: "proofPoints", title: "Proof points", kind: "rows", max: 20, add: "Add proof point", blank: () => ({ claim: "", source: "usp" }), fields: [
    { k: "claim", label: "Claim", type: "area", rows: 2 },
    { k: "source", label: "From", type: "select", options: SOURCES }
  ] },
  { key: "offers", title: "Offers", kind: "rows", max: 20, add: "Add offer", blank: () => ({ name: "", terms: "", validUntil: "" }), fields: [
    { k: "name", label: "Offer", type: "text" },
    { k: "terms", label: "Terms", type: "area", rows: 2 },
    { k: "validUntil", label: "Valid until", type: "text" }
  ] },
  { key: "competitorGaps", title: "Competitor gaps", kind: "rows", max: 20, add: "Add competitor gap", blank: () => ({ competitor: "", gap: "" }), fields: [
    { k: "competitor", label: "Competitor", type: "text" },
    { k: "gap", label: "Gap we can use", type: "area", rows: 2 }
  ] },
  { key: "founderStory", title: "Founder story", kind: "object", fields: [
    { k: "short", label: "Short (for captions and ads)", type: "area", rows: 3 },
    { k: "long", label: "Long", type: "area", rows: 10 }
  ] },
  { key: "faqBank", title: "FAQ bank", kind: "rows", max: 40, add: "Add question", blank: () => ({ q: "", a: "" }), fields: [
    { k: "q", label: "Question", type: "text" },
    { k: "a", label: "Answer", type: "area", rows: 2 }
  ] },
  { key: "contentPillars", title: "Content pillars", kind: "lines", label: "One per line" },
  { key: "imageNotes", title: "Image notes", kind: "rows", max: 20, picture: true, fields: [
    { k: "caption", label: "What is in the picture", type: "area", rows: 2 },
    { k: "bestUse", label: "Best use", type: "area", rows: 2 }
  ] }
];

const toLines = (a) => (Array.isArray(a) ? a.join("\n") : "");
const fromLines = (s) => String(s || "").split("\n").map((x) => x.trim()).filter(Boolean);

/* ---------- the module ---------- */

export function createBrain(ctx) {
  const { h, clear, api, when } = ctx;
  const cache = {};
  let promptDef = null;
  let schema = null;

  function entry(id) {
    if (!cache[id]) {
      cache[id] = { loaded: false, loading: false, versions: [], latest: null, view: null, working: null, dirty: false, building: false, steps: [], error: null, errors: null, saveMsg: null, older: {} };
      try {
        const raw = localStorage.getItem(DRAFT_PREFIX + id);
        if (raw) {
          const d = JSON.parse(raw);
          if (d && d.doc) {
            cache[id].working = d.doc;
            cache[id].dirty = true;
            cache[id].view = "draft";
          }
        }
      } catch (e) {}
    }
    return cache[id];
  }

  function keepDraft(id) {
    const e = entry(id);
    try {
      if (e.working && e.dirty) localStorage.setItem(DRAFT_PREFIX + id, JSON.stringify({ at: new Date().toISOString(), doc: e.working }));
      else localStorage.removeItem(DRAFT_PREFIX + id);
    } catch (err) {}
  }

  async function getSchema() {
    if (!schema) {
      const r = await fetch(VAULT + "/schemas/brain", { credentials: "same-origin" });
      if (!r.ok) throw new Error("Could not load the brain schema.");
      schema = await r.json();
    }
    return schema;
  }

  async function getPrompt() {
    if (!promptDef) {
      const r = await fetch(PROMPT_URL, { credentials: "same-origin" });
      if (!r.ok) throw new Error("Could not load the Business Brain prompt.");
      promptDef = await r.json();
    }
    return promptDef;
  }

  function load(id, force) {
    const e = entry(id);
    if ((e.loaded && !force) || e.loading) return;
    e.loading = true;
    api("/admin/brain/" + encodeURIComponent(id)).then((r) => {
      e.loading = false;
      if (!r.ok || !r.d) {
        e.error = "Could not load saved brains. Try again in a moment.";
      } else {
        e.loaded = true;
        e.versions = r.d.versions || [];
        e.latest = r.d.latest;
        if (!e.view) e.view = e.latest ? "v" + e.latest.brainVersion : null;
      }
      ctx.rerender(id);
    });
  }

  /* ----- state the header button needs ----- */
  function buttonState(c, d) {
    const e = entry(c.id);
    if (e.building) return { label: "Building...", disabled: true, hint: "Working on it. You can keep using ScriptForge." };
    if (!d || d.source !== "submitted") return { label: "Build Business Brain", disabled: true, hint: "Waiting for the client to submit the profile." };
    const p = ctx.providerInfo();
    const label = !c.latestBrainVersion ? "Build Business Brain" : c.hasNewIntake ? "Regenerate from latest intake (v" + c.latestIntakeVersion + ")" : "Rebuild Business Brain";
    if (!p.hasKey) return { label, disabled: false, noKey: true, hint: "Add your " + p.label + " key in section 2 first." };
    const pics = d.files.filter((f) => f.section === "pictures").length;
    const sees = VISION[p.provider] ? (pics ? ", including " + Math.min(pics, MAX_PICTURES) + " pictures" : "") : (pics ? ". " + p.label + " cannot see pictures, so it gets their names only" : "");
    return { label, disabled: false, hint: "Uses " + p.label + (p.model ? " · " + p.model : "") + " with your key from section 2. Sends this intake" + sees + "." };
  }

  /* ----- building ----- */
  function step(e, id, text, state) {
    const last = e.steps[e.steps.length - 1];
    if (last && last.state === "run") last.state = "done";
    if (text) e.steps.push({ text, state: state || "run" });
    ctx.rerender(id);
  }

  async function build(c, d) {
    const id = c.id;
    const e = entry(id);
    if (e.building) return;
    const p = ctx.providerInfo(true);
    if (!p.key) {
      ctx.pointToSection2();
      return;
    }
    e.building = true;
    e.error = null;
    e.errors = null;
    e.saveMsg = null;
    e.steps = [];
    ctx.rerender(id);
    try {
      step(e, id, "Loading the prompt and the brain schema");
      const [prompt, sch] = await Promise.all([getPrompt(), getSchema()]);
      const intake = d.intake;
      const files = d.files || [];

      const docs = files.filter((f) => ["founderStory", "faqs", "reviews"].includes(f.section) && !/^image\//.test(f.mime));
      const extracted = [];
      if (docs.length) {
        step(e, id, "Reading " + docs.length + (docs.length === 1 ? " document" : " documents"));
        for (const f of docs) {
          try {
            extracted.push({ section: f.section, name: f.name, text: await readDocument(f) });
          } catch (err) {
            extracted.push({ section: f.section, name: f.name, text: "", note: "Could not be read" });
          }
        }
      }

      const pictures = files.filter((f) => f.section === "pictures").slice(0, MAX_PICTURES);
      const vision = !!VISION[p.provider];
      const images = [];
      if (pictures.length && vision) {
        step(e, id, "Preparing " + pictures.length + (pictures.length === 1 ? " picture" : " pictures"));
        for (const f of pictures) {
          try {
            images.push({ file: f, img: await shrinkPicture(f) });
          } catch (err) {}
        }
      }

      const material = {
        companyName: intake.profile && intake.profile.companyName,
        campaignLanguage: intake.campaignLanguage,
        answerLanguage: intake.answerLanguage,
        profile: intake.profile,
        founderStory: intake.uploads && intake.uploads.founderStory ? intake.uploads.founderStory.text : "",
        previousPosts: ((intake.uploads && intake.uploads.previousPosts) || []).filter((x) => x.type !== "image"),
        previousPostScreenshots: files.filter((f) => f.section === "previousPosts").map((f) => f.name),
        faqs: intake.uploads && intake.uploads.faqs ? intake.uploads.faqs.rows : [],
        extractedDocuments: extracted
      };
      const languages = languagesFor(intake.campaignLanguage);
      const langRule = prompt.languageRules[intake.campaignLanguage] || prompt.languageRules.en;
      const system = fill(prompt.system.join("\n"), { LANGUAGE_RULE: langRule, SCHEMA: JSON.stringify(modelSchema(sch)) });
      const picNote = !pictures.length
        ? prompt.noPictures
        : images.length
          ? prompt.picturesShown
          : fill(prompt.picturesListed, { PICTURE_LIST: pictures.map((f) => f.id + " (" + f.name + ")").join(", ") });
      const userText = fill(prompt.user.join("\n"), { INTAKE_VERSION: String(d.version), INTAKE_JSON: JSON.stringify(material, null, 1), PICTURES_NOTE: picNote });

      let firstContent;
      if (images.length) {
        firstContent = [];
        images.forEach((x, i) => {
          firstContent.push({ type: "text", text: "Picture " + (i + 1) + ", file id " + x.file.id + " (" + x.file.name + "):" });
          firstContent.push({ type: "image", source: { type: "base64", media_type: x.img.media_type, data: x.img.data } });
        });
        firstContent.push({ type: "text", text: userText });
      } else firstContent = userText;
      const messages = [{ role: "user", content: firstContent }];
      const maxTokens = (prompt.maxTokens && prompt.maxTokens[p.provider]) || 8000;
      const nctx = {
        intake, clientId: id, schema: sch, languages,
        pictureIds: pictures.map((f) => f.id),
        intakeVersion: d.version,
        nextVersion: (c.latestBrainVersion || 0) + 1
      };

      step(e, id, "Asking " + p.label + " to build the brain (this can take a minute or two)");
      let reply = await callModel(p, system, messages, maxTokens);
      let doc = null;
      let errs = null;
      try {
        doc = normalizeBrain(extractJson(reply), nctx);
        const v = validate(sch, doc);
        if (!v.valid) errs = v.errors;
      } catch (err) {
        errs = [err.message];
      }
      if (errs) {
        step(e, id, "The first answer had " + errs.length + (errs.length === 1 ? " problem" : " problems") + ". Asking once more with the list");
        const retryMsgs = messages.concat([
          { role: "assistant", content: reply.slice(0, 60000) },
          { role: "user", content: fill(prompt.retry, { ERRORS: errs.slice(0, 30).map((x) => "- " + x).join("\n") }) }
        ]);
        reply = await callModel(p, system, retryMsgs, maxTokens);
        errs = null;
        try {
          doc = normalizeBrain(extractJson(reply), nctx);
          const v = validate(sch, doc);
          if (!v.valid) errs = v.errors;
        } catch (err) {
          errs = [err.message];
        }
      }
      if (errs) {
        e.errors = errs;
        throw new Error("The answer still did not match the brain schema after one retry.");
      }
      step(e, id, "Brain ready to review", "done");
      e.working = doc;
      e.dirty = true;
      e.view = "draft";
      keepDraft(id);
    } catch (err) {
      const last = e.steps[e.steps.length - 1];
      if (last) last.state = "fail";
      e.error = err.message || "Something went wrong.";
    }
    e.building = false;
    ctx.rerender(id);
  }

  /* ----- saving ----- */
  async function save(c) {
    const id = c.id;
    const e = entry(id);
    if (!e.working) return;
    const sch = await getSchema();
    const v = validate(sch, e.working);
    if (!v.valid) {
      e.saveMsg = { cls: "err", text: "Fix these before saving: " + v.errors.slice(0, 6).join("; ") };
      ctx.rerender(id);
      return;
    }
    e.saveMsg = { cls: "info", text: "Saving..." };
    ctx.rerender(id);
    const r = await api("/admin/brain/" + encodeURIComponent(id), { method: "POST", body: { brain: e.working } });
    if (r.ok && r.d && r.d.brain) {
      e.latest = r.d.brain;
      e.versions = [{ version: r.d.brainVersion, builtFromIntakeVersion: r.d.brain.builtFromIntakeVersion, createdAt: r.d.createdAt, editedByHarry: r.d.brain.editedByHarry }].concat(e.versions);
      e.working = null;
      e.dirty = false;
      e.view = "v" + r.d.brainVersion;
      keepDraft(id);
      e.saveMsg = { cls: "ok", text: "Saved as brain v" + r.d.brainVersion + ". The client now sees: " + (r.d.statusLabel ? r.d.statusLabel.en : r.d.status) + "." };
      ctx.onSaved(id);
    } else {
      const det = r.d && r.d.details ? " " + r.d.details.slice(0, 6).join("; ") : "";
      e.saveMsg = { cls: "err", text: ((r.d && r.d.message && r.d.message.en) || "Could not save.") + det };
    }
    ctx.rerender(id);
  }

  function discard(id) {
    const e = entry(id);
    e.working = null;
    e.dirty = false;
    e.view = e.latest ? "v" + e.latest.brainVersion : null;
    e.saveMsg = null;
    keepDraft(id);
    ctx.rerender(id);
  }

  /* ----- rendering ----- */

  function inputFor(f, value, readOnly, onChange) {
    const idp = "gcb-" + Math.random().toString(36).slice(2, 9);
    let el;
    if (f.type === "select") {
      el = h("select", { id: idp, disabled: readOnly }, f.options.map((o) => h("option", { value: o[0], selected: value === o[0] }, o[1])));
      el.addEventListener("change", () => onChange(el.value));
    } else if (f.type === "text") {
      el = h("input", { id: idp, type: "text", readonly: readOnly });
      el.value = value == null ? "" : String(value);
      el.addEventListener("input", () => onChange(el.value));
    } else {
      const lines = f.type === "lines";
      el = h("textarea", { id: idp, class: "gc-ta", rows: String(f.rows || (lines ? Math.min(8, Math.max(2, (value || []).length + 1)) : 3)), readonly: readOnly });
      el.value = lines ? toLines(value) : value == null ? "" : String(value);
      el.addEventListener("input", () => onChange(lines ? fromLines(el.value) : el.value));
    }
    return h("div", { class: "gc-ed" }, h("label", { for: idp, text: f.label }), el);
  }

  function renderCards(pane, c, d, doc, readOnly, onEdit) {
    const byId = {};
    (d && d.files ? d.files : []).forEach((f) => { byId[f.id] = f; });
    const grid = h("div", { class: "gc-cards" });
    CARDS.forEach((card) => {
      const body = h("div", { class: "gc-card-body" });
      const head = h("div", { class: "gc-card-head" }, h("h4", { text: card.title }));
      const box = h("section", { class: "gc-card" + (card.kind === "rows" || card.key === "founderStory" ? " wide" : "") }, head, body);
      if (card.kind === "object") {
        const obj = doc[card.key] || {};
        card.fields.forEach((f) => body.appendChild(inputFor(f, obj[f.k], readOnly, (v) => { obj[f.k] = v; doc[card.key] = obj; onEdit(); })));
      } else if (card.kind === "lines") {
        body.appendChild(inputFor({ label: card.label, type: "lines" }, doc[card.key] || [], readOnly, (v) => { doc[card.key] = v; onEdit(); }));
      } else {
        const list = Array.isArray(doc[card.key]) ? doc[card.key] : (doc[card.key] = []);
        head.appendChild(h("span", { class: "gc-meta", text: list.length + (card.max ? " of " + card.max : "") }));
        if (!list.length) body.appendChild(h("div", { class: "gc-meta", text: card.key === "competitorGaps" ? "None. The client named no competitors." : "None." }));
        list.forEach((item, i) => {
          const row = h("div", { class: "gc-row-ed" });
          if (card.picture) {
            const f = byId[item.fileId];
            row.appendChild(f ? h("img", { class: "gc-thumb", src: f.url, alt: f.name || "Client picture" }) : h("div", { class: "gc-meta", text: item.fileId }));
          }
          if (card.itemTitle) row.appendChild(h("div", { class: "gc-row-title", text: card.itemTitle(item, i) }));
          const fields = h("div", { class: "gc-row-fields" });
          card.fields.forEach((f) => fields.appendChild(inputFor(f, item[f.k], readOnly, (v) => { item[f.k] = v; onEdit(); })));
          row.appendChild(fields);
          if (!readOnly && (!card.min || list.length > card.min)) {
            row.appendChild(h("button", { type: "button", class: "gc-link gc-remove", on: { click: () => { list.splice(i, 1); onEdit(true); } } }, "Remove"));
          }
          body.appendChild(row);
        });
        if (!readOnly && card.add && (!card.max || list.length < card.max)) {
          body.appendChild(h("button", { type: "button", class: "btn-copy", on: { click: () => { list.push(card.blank()); onEdit(true); } } }, "+ " + card.add));
        }
      }
      grid.appendChild(box);
    });
    pane.appendChild(grid);
  }

  function renderTab(pane, c, d) {
    const e = entry(c.id);
    load(c.id);

    if (e.building || e.steps.length) {
      const box = h("div", { class: "gc-box" }, h("div", { class: "gc-bh" }, e.building ? "Building the Business Brain" : e.error ? "The build stopped" : "Build finished"));
      const ol = h("ol", { class: "gc-steps" });
      e.steps.forEach((s) => ol.appendChild(h("li", { class: "gc-step " + s.state }, s.state === "run" ? h("span", { class: "spin" }) : null, s.text)));
      box.appendChild(ol);
      if (e.error) box.appendChild(h("div", { class: "gc-msg err", text: e.error }));
      if (e.errors) box.appendChild(h("div", { class: "gc-files" }, e.errors.slice(0, 20).map((x) => h("div", { class: "gc-meta", text: x }))));
      if (!e.building) box.appendChild(h("button", { type: "button", class: "gc-link", on: { click: () => { e.steps = []; e.error = null; e.errors = null; ctx.rerender(c.id); } } }, "Hide this"));
      pane.appendChild(box);
      if (e.building) return;
    }

    if (!e.loaded && !e.working) {
      pane.appendChild(h("div", { class: "gc-msg info" }, h("span", { class: "spin" }), "Loading saved brains..."));
      return;
    }

    /* Version picker */
    const opts = [];
    if (e.working) opts.push(["draft", "Unsaved draft" + (e.working.builtFromIntakeVersion ? " (from intake v" + e.working.builtFromIntakeVersion + ")" : "")]);
    e.versions.forEach((v, i) => opts.push(["v" + v.version, "Brain v" + v.version + (i === 0 ? " (latest)" : "") + " · intake v" + v.builtFromIntakeVersion + " · " + when(v.createdAt) + (v.editedByHarry ? " · edited" : "")]));
    if (!opts.length) {
      pane.appendChild(h("div", { class: "gc-soon" }, h("b", { text: "No Business Brain yet. " }),
        d && d.source === "submitted"
          ? "Press Build Business Brain above. It turns intake v" + d.version + " into editable cards: positioning, personas, voice rules, words to use and avoid, proof points, offers, competitor gaps, founder story, FAQ bank, content pillars and image notes. Nothing is saved until you press Save Brain."
          : "The client has not submitted the profile yet."));
      return;
    }
    if (!e.view || !opts.some((o) => o[0] === e.view)) e.view = opts[0][0];
    const sel = h("select", { id: "gcBrainVersion", class: "gc-select" }, opts.map((o) => h("option", { value: o[0], selected: o[0] === e.view }, o[1])));
    sel.addEventListener("change", () => {
      e.view = sel.value;
      e.saveMsg = null;
      if (e.view !== "draft" && e.view !== "v" + (e.latest && e.latest.brainVersion) && !e.older[e.view]) {
        api("/admin/brain/" + encodeURIComponent(c.id) + "/" + e.view.slice(1)).then((r) => {
          if (r.ok && r.d) e.older[e.view] = r.d.brain;
          ctx.rerender(c.id);
        });
      }
      ctx.rerender(c.id);
    });

    let doc;
    let readOnly = false;
    if (e.view === "draft") {
      doc = e.working;
    } else if (e.latest && e.view === "v" + e.latest.brainVersion) {
      /* Cards edit a copy, so the saved version never changes in place. */
      doc = JSON.parse(JSON.stringify(e.latest));
    } else {
      doc = e.older[e.view];
      readOnly = true;
      if (!doc) {
        pane.appendChild(h("div", { class: "gc-bar" }, h("label", { for: "gcBrainVersion", class: "gc-label", text: "Version" }), sel));
        pane.appendChild(h("div", { class: "gc-msg info" }, h("span", { class: "spin" }), "Loading..."));
        return;
      }
    }

    const hdr = h("div", { class: "gc-brain-hdr" });
    function fillHeader() {
      clear(hdr);
      const isDraft = e.view === "draft";
      let note;
      if (isDraft) note = "Unsaved draft. Edit anything, then press Save Brain to store it as brain v" + ((e.versions[0] ? e.versions[0].version : 0) + 1) + ". Older versions stay readable.";
      else if (readOnly) note = "Older version, read only.";
      else note = "Saved brain v" + e.latest.brainVersion + ". Changing any card starts a new draft; the saved version stays as it is.";
      const tools = h("div", { class: "gc-brain-tools" });
      if (isDraft) {
        tools.appendChild(h("button", { type: "button", class: "gc-brain-btn", on: { click: () => save(c) } }, "Save Brain"));
        tools.appendChild(h("button", { type: "button", class: "btn-ghost", on: { click: () => discard(c.id) } }, "Discard draft"));
      } else if (readOnly) {
        tools.appendChild(h("button", { type: "button", class: "btn-ghost", on: { click: () => {
          e.working = JSON.parse(JSON.stringify(doc));
          e.working.editedByHarry = true;
          e.dirty = true;
          e.view = "draft";
          keepDraft(c.id);
          ctx.rerender(c.id);
        } } }, "Use as a starting point"));
      }
      tools.appendChild(h("button", { type: "button", class: "gc-link", on: { click: () => downloadJson(c, doc, isDraft) } }, "Download brain (JSON)"));
      if (isDraft && !sel.querySelector('option[value="draft"]')) {
        sel.insertBefore(h("option", { value: "draft" }, "Unsaved draft (from intake v" + doc.builtFromIntakeVersion + ")"), sel.firstChild);
        sel.value = "draft";
      }
      hdr.appendChild(h("div", { class: "gc-bar" },
        h("div", { class: "gc-verpick" }, h("label", { for: "gcBrainVersion", class: "gc-label", text: "Version" }), sel),
        tools));
      hdr.appendChild(h("div", { class: "gc-meta", text: note }));
      if (e.saveMsg) hdr.appendChild(h("div", { class: "gc-msg " + e.saveMsg.cls, role: "status", text: e.saveMsg.text }));
    }
    fillHeader();
    pane.appendChild(hdr);

    renderCards(pane, c, d, doc, readOnly, (structural) => {
      const wasDraft = e.view === "draft";
      if (!wasDraft) {
        e.working = doc;
        e.view = "draft";
      }
      e.working.editedByHarry = true;
      e.dirty = true;
      const hadMsg = !!e.saveMsg;
      e.saveMsg = null;
      keepDraft(c.id);
      if (structural) ctx.rerender(c.id);
      else if (!wasDraft || hadMsg) fillHeader();
    });
  }

  function downloadJson(c, doc, isDraft) {
    const slug = String(c.name || "client").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "client";
    const blob = new Blob([JSON.stringify(doc, null, 2)], { type: "application/json" });
    const a = h("a", { href: URL.createObjectURL(blob), download: "brain-" + slug + "-" + (isDraft ? "draft" : "v" + doc.brainVersion) + ".json" });
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }

  function reset(id) {
    if (cache[id]) {
      cache[id].loaded = false;
    }
  }

  return { renderTab, buttonState, build, load, reset, entry };
}
