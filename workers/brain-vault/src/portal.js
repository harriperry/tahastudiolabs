/* Client endpoints for the onboarding portal (phase 2).
   Every handler receives an auth object for the signed-in client and only ever reads or
   writes rows for auth.clientId. Admins may read files (phase 3 uses that); nothing else here
   is reachable by an admin.
   Endpoints (all under /api/vault):
     GET  /portal/state     everything the portal needs on load
     POST /consent          records consent version, language, time
     GET  /intake           the client's draft intake
     PUT  /intake           auto-save of the draft
     POST /uploads          one file per request, raw body, ?section=...
     GET  /files/:id        serves a file the caller is allowed to see
     DELETE /files/:id      the client removes one of its own files
     POST /intake/submit    freezes the draft as intake version N, status Submitted, emails Harry
     GET  /status           current status and history
     PUT  /me/language      remembers the client's portal language */
import { STATUS_LABELS } from "./config.js";
import { SCHEMAS } from "./schemas.js";
import { validate } from "./validate.js";
import { SECTIONS, TYPES, extOf, looksLikeVideo, magicOk, r2Key } from "./files.js";
import { composeSubmitNotice, sendMail } from "./mail.js";
import { fileRemoved, openRequest, receivePhoto } from "./photos.js";
import { json, lang, newId, nowIso, readJson } from "./util.js";

const M = {
  badRequest: { sv: "Ogiltig förfrågan.", en: "Bad request." },
  consent: { sv: "Du behöver godkänna informationen om personuppgifter först.", en: "Please accept the data information first." },
  invalid: { sv: "Något i formuläret har fel format.", en: "Something in the form has the wrong format." },
  missing: { sv: "Fyll i de obligatoriska fälten innan du skickar.", en: "Fill in the required fields before you submit." },
  section: { sv: "Okänd uppladdningsdel.", en: "Unknown upload section." },
  video: { sv: "Videofiler kan inte laddas upp. Ladda upp bilder i stället.", en: "Video files can't be uploaded. Upload pictures instead." },
  type: { sv: "Den filtypen stöds inte här.", en: "That file type isn't supported here." },
  size: { sv: "Filen är för stor.", en: "The file is too large." },
  count: { sv: "Du har nått maxantalet filer för den här delen.", en: "You have reached the maximum number of files for this section." },
  content: { sv: "Filens innehåll matchar inte filtypen.", en: "The file content doesn't match its type." },
  notFound: { sv: "Hittades inte.", en: "Not found." },
  files: { sv: "En bifogad fil finns inte längre. Ladda upp den igen.", en: "An attached file no longer exists. Please upload it again." },
  request: { sv: "Den bildförfrågan är redan besvarad eller borttagen.", en: "That photo request has already been answered or cancelled." }
};

/* Fields that must be filled before submit, as listed in the intake schema. */
const REQUIRED = SCHEMAS.intake["x-requiredOnSubmit"] || [];

function get(obj, path) {
  return path.split(".").reduce((o, k) => (o == null ? undefined : o[k]), obj);
}

export function emptyIntake(clientId, language) {
  return {
    schemaVersion: "intake-1",
    clientId,
    intakeVersion: 0,
    submittedAt: null,
    answerLanguage: language,
    campaignLanguage: "",
    profile: {
      companyName: "",
      website: "",
      location: "",
      productService: "",
      targetAudience: "",
      brandVoice: { text: "", toneChips: [] },
      usp: "",
      offers: [],
      competitors: [],
      reviews: { pasted: [], fileIds: [] },
      brandWords: { use: [], avoid: [] }
    },
    uploads: {
      pictures: [],
      founderStory: { text: "", fileId: null },
      previousPosts: [],
      faqs: { rows: [], fileId: null }
    },
    consent: { version: "", acceptedAt: "", language }
  };
}

async function latestConsent(env, clientId) {
  return env.DB.prepare("SELECT version, language, accepted_at FROM consents WHERE client_id = ? ORDER BY id DESC LIMIT 1")
    .bind(clientId)
    .first();
}

async function consentOk(env, cfg, clientId) {
  const c = await latestConsent(env, clientId);
  return c && c.version === cfg.consentVersion ? c : null;
}

async function latestIntake(env, clientId) {
  return env.DB.prepare("SELECT version, data, submitted_at FROM intakes WHERE client_id = ? ORDER BY version DESC LIMIT 1")
    .bind(clientId)
    .first();
}

async function loadDraft(env, client) {
  const d = await env.DB.prepare("SELECT data FROM intake_drafts WHERE client_id = ?").bind(client.id).first();
  if (d) return JSON.parse(d.data);
  const last = await latestIntake(env, client.id);
  if (last) return JSON.parse(last.data);
  return emptyIntake(client.id, client.language);
}

async function setStatus(env, clientId, status, by) {
  const t = nowIso();
  await env.DB.batch([
    env.DB.prepare("UPDATE clients SET status = ?, updated_at = ? WHERE id = ?").bind(status, t, clientId),
    env.DB.prepare("INSERT INTO status_history (client_id, status, changed_at, changed_by) VALUES (?, ?, ?, ?)").bind(clientId, status, t, by)
  ]);
}

async function history(env, clientId) {
  const r = await env.DB.prepare("SELECT status, changed_at FROM status_history WHERE client_id = ? ORDER BY id ASC").bind(clientId).all();
  return (r.results || []).map((h) => ({ status: h.status, label: STATUS_LABELS[h.status], at: h.changed_at }));
}

async function listFiles(env, clientId) {
  const r = await env.DB.prepare("SELECT id, section, mime, size, original_name, created_at FROM files WHERE client_id = ? ORDER BY created_at ASC")
    .bind(clientId)
    .all();
  return (r.results || []).map((f) => ({ id: f.id, section: f.section, mime: f.mime, size: f.size, name: f.original_name, createdAt: f.created_at }));
}

/* Every file id the intake refers to must belong to this client. */
function referencedFileIds(doc) {
  const ids = [];
  const p = doc.profile || {};
  const u = doc.uploads || {};
  (p.reviews && p.reviews.fileIds ? p.reviews.fileIds : []).forEach((x) => ids.push(x));
  (u.pictures || []).forEach((x) => ids.push(x.fileId));
  if (u.founderStory && u.founderStory.fileId) ids.push(u.founderStory.fileId);
  if (u.faqs && u.faqs.fileId) ids.push(u.faqs.fileId);
  (u.previousPosts || []).forEach((x) => {
    if (x.type === "image") ids.push(x.value);
  });
  return ids.filter(Boolean);
}

async function filesBelong(env, clientId, ids) {
  if (!ids.length) return true;
  const unique = [...new Set(ids)];
  const q = "SELECT COUNT(*) AS n FROM files WHERE client_id = ? AND id IN (" + unique.map(() => "?").join(",") + ")";
  const r = await env.DB.prepare(q).bind(clientId, ...unique).first();
  return r.n === unique.length;
}

async function getClient(env, clientId) {
  return env.DB.prepare("SELECT id, name, email, language, status FROM clients WHERE id = ?").bind(clientId).first();
}

export async function portalState(env, cfg, auth) {
  const client = await getClient(env, auth.clientId);
  if (!client) return json({ error: "not_found", message: M.notFound }, 404);
  const consent = await latestConsent(env, client.id);
  const last = await latestIntake(env, client.id);
  return json({
    client: { id: client.id, name: client.name, language: client.language, status: client.status, statusLabel: STATUS_LABELS[client.status] },
    consent: {
      currentVersion: cfg.consentVersion,
      accepted: !!(consent && consent.version === cfg.consentVersion),
      acceptedAt: consent ? consent.accepted_at : null,
      retentionMonths: cfg.retentionMonths,
      contactEmail: cfg.tahaEmail,
      privacyUrl: cfg.privacyUrl
    },
    productName: cfg.productName,
    draft: await loadDraft(env, client),
    latestIntakeVersion: last ? last.version : 0,
    latestSubmittedAt: last ? last.submitted_at : null,
    history: await history(env, client.id),
    files: await listFiles(env, client.id),
    limits: SECTIONS
  });
}

export async function postConsent(request, env, cfg, auth) {
  const b = await readJson(request, 2048);
  if (!b || b.accepted !== true) return json({ error: "bad_request", message: M.badRequest }, 400);
  const t = nowIso();
  await env.DB.prepare("INSERT INTO consents (client_id, version, language, accepted_at) VALUES (?, ?, ?, ?)")
    .bind(auth.clientId, cfg.consentVersion, lang(b.language), t)
    .run();
  return json({ ok: true, version: cfg.consentVersion, acceptedAt: t });
}

export async function getIntake(env, cfg, auth) {
  const client = await getClient(env, auth.clientId);
  if (!client) return json({ error: "not_found", message: M.notFound }, 404);
  return json({ draft: await loadDraft(env, client) });
}

/* Builds the stored document: the client sends answers only; ids, versions and consent
   are always set by the server. */
function buildDoc(body, clientId, base, consent) {
  return {
    schemaVersion: "intake-1",
    clientId,
    intakeVersion: base.intakeVersion || 0,
    submittedAt: base.submittedAt || null,
    answerLanguage: lang(body.answerLanguage),
    campaignLanguage: typeof body.campaignLanguage === "string" ? body.campaignLanguage : "",
    profile: body.profile,
    uploads: body.uploads,
    consent: { version: consent.version, acceptedAt: consent.accepted_at, language: consent.language }
  };
}

export async function putIntake(request, env, cfg, auth) {
  const consent = await consentOk(env, cfg, auth.clientId);
  if (!consent) return json({ error: "consent_required", message: M.consent }, 403);
  const b = await readJson(request, 1024 * 1024);
  if (!b || typeof b.profile !== "object" || typeof b.uploads !== "object") return json({ error: "bad_request", message: M.badRequest }, 400);
  const client = await getClient(env, auth.clientId);
  const base = await loadDraft(env, client);
  const doc = buildDoc(b, auth.clientId, base, consent);
  const v = validate(SCHEMAS.intake, doc);
  if (!v.valid) return json({ error: "invalid", message: M.invalid, details: v.errors }, 400);
  if (!(await filesBelong(env, auth.clientId, referencedFileIds(doc)))) return json({ error: "files", message: M.files }, 400);
  const t = nowIso();
  await env.DB.prepare(
    "INSERT INTO intake_drafts (client_id, data, answer_language, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(client_id) DO UPDATE SET data = excluded.data, answer_language = excluded.answer_language, updated_at = excluded.updated_at"
  )
    .bind(auth.clientId, JSON.stringify(doc), doc.answerLanguage, t)
    .run();
  if (client.status === "invited") await setStatus(env, auth.clientId, "profile_in_progress", "client");
  return json({ ok: true, savedAt: t });
}

export async function postUpload(request, env, cfg, auth, url, ctx) {
  const consent = await consentOk(env, cfg, auth.clientId);
  if (!consent) return json({ error: "consent_required", message: M.consent }, 403);
  const section = url.searchParams.get("section") || "";
  const rule = SECTIONS[section];
  if (!rule) return json({ error: "section", message: M.section }, 400);
  /* V2 phase G2a: a picture that answers a photo request. It does not count towards the 20
     pictures of the profile (at most 20 more), and it becomes the brief's photo. */
  const reqId = url.searchParams.get("request");
  let photoReq = null;
  if (reqId) {
    photoReq = section === "pictures" ? await openRequest(env, auth.clientId, reqId) : null;
    if (!photoReq) return json({ error: "request", message: M.request }, 409);
  }
  let name = "";
  try {
    name = decodeURIComponent(request.headers.get("X-File-Name") || "").slice(0, 200);
  } catch (e) {
    name = "";
  }
  const ctype = request.headers.get("Content-Type") || "";
  if (looksLikeVideo(name, ctype)) return json({ error: "video", message: M.video }, 415);
  const ext = extOf(name);
  if (!rule.ext.includes(ext)) return json({ error: "type", message: M.type }, 415);
  const len = parseInt(request.headers.get("Content-Length") || "0", 10);
  if (!len || len > rule.maxBytes) return json({ error: "size", message: M.size }, 413);
  const count = await env.DB.prepare("SELECT COUNT(*) AS n FROM files WHERE client_id = ? AND section = ?").bind(auth.clientId, section).first();
  if (count.n >= rule.maxCount + (photoReq ? 20 : 0)) return json({ error: "count", message: M.count }, 409);
  const buf = new Uint8Array(await request.arrayBuffer());
  if (!buf.length || buf.length > rule.maxBytes) return json({ error: "size", message: M.size }, 413);
  const type = TYPES[ext];
  if (!magicOk(type.magic, buf)) return json({ error: "content", message: M.content }, 415);
  const id = newId("f", 16);
  const key = r2Key(auth.clientId, id);
  await env.FILES.put(key, buf, { httpMetadata: { contentType: type.mime } });
  const t = nowIso();
  await env.DB.prepare("INSERT INTO files (id, client_id, section, mime, size, r2_key, original_name, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
    .bind(id, auth.clientId, section, type.mime, buf.length, key, name, t)
    .run();
  const out = { ok: true, file: { id, section, mime: type.mime, size: buf.length, name, createdAt: t } };
  if (photoReq) out.request = Object.assign({ id: photoReq.id, state: "received" }, await receivePhoto(env, cfg, ctx, auth.clientId, photoReq, id));
  return json(out, 201);
}

export async function getFile(env, auth, fileId) {
  const f = await env.DB.prepare("SELECT client_id, mime, r2_key, original_name FROM files WHERE id = ?").bind(fileId).first();
  if (!f || (auth.role !== "admin" && f.client_id !== auth.clientId)) return json({ error: "not_found", message: M.notFound }, 404);
  const obj = await env.FILES.get(f.r2_key);
  if (!obj) return json({ error: "not_found", message: M.notFound }, 404);
  const isImage = /^image\//.test(f.mime);
  const safeName = String(f.original_name || "file").replace(/[^\w.\- ]+/g, "_");
  return new Response(obj.body, {
    headers: {
      "Content-Type": f.mime,
      "Content-Disposition": (isImage ? "inline" : "attachment") + '; filename="' + safeName + '"',
      "Cache-Control": "private, max-age=600",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox"
    }
  });
}

export async function deleteFile(env, auth, fileId) {
  const f = await env.DB.prepare("SELECT r2_key FROM files WHERE id = ? AND client_id = ?").bind(fileId, auth.clientId).first();
  if (!f) return json({ error: "not_found", message: M.notFound }, 404);
  await env.FILES.delete(f.r2_key);
  await env.DB.prepare("DELETE FROM files WHERE id = ? AND client_id = ?").bind(fileId, auth.clientId).run();
  await fileRemoved(env, auth.clientId, fileId);
  return json({ ok: true });
}

export async function submitIntake(env, cfg, auth, ctx) {
  const consent = await consentOk(env, cfg, auth.clientId);
  if (!consent) return json({ error: "consent_required", message: M.consent }, 403);
  const client = await getClient(env, auth.clientId);
  const draft = await loadDraft(env, client);
  const missing = REQUIRED.filter((p) => {
    const v = get(draft, p);
    return v == null || (typeof v === "string" && !v.trim());
  });
  if (missing.length) return json({ error: "missing", message: M.missing, missing }, 400);
  if (!(await filesBelong(env, auth.clientId, referencedFileIds(draft)))) return json({ error: "files", message: M.files }, 400);
  const last = await latestIntake(env, auth.clientId);
  const version = (last ? last.version : 0) + 1;
  const t = nowIso();
  const doc = Object.assign({}, draft, {
    intakeVersion: version,
    submittedAt: t,
    consent: { version: consent.version, acceptedAt: consent.accepted_at, language: consent.language }
  });
  const v = validate(SCHEMAS.intake, doc);
  if (!v.valid) return json({ error: "invalid", message: M.invalid, details: v.errors }, 400);
  await env.DB.batch([
    env.DB.prepare("INSERT INTO intakes (client_id, version, data, submitted_at) VALUES (?, ?, ?, ?)").bind(auth.clientId, version, JSON.stringify(doc), t),
    env.DB.prepare(
      "INSERT INTO intake_drafts (client_id, data, answer_language, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(client_id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at"
    ).bind(auth.clientId, JSON.stringify(doc), doc.answerLanguage, t)
  ]);
  await setStatus(env, auth.clientId, "submitted", "client");
  const mail = composeSubmitNotice(cfg, {
    company: String(doc.profile.companyName || client.name).slice(0, 120),
    version,
    link: cfg.growthPanelUrl
  });
  ctx.waitUntil(sendMail(cfg, env, { to: cfg.tahaEmail, ...mail }).catch((e) => console.error("submit notice failed: " + e.message)));
  return json({ ok: true, intakeVersion: version, submittedAt: t, status: "submitted", statusLabel: STATUS_LABELS.submitted });
}

export async function getStatus(env, auth) {
  const client = await getClient(env, auth.clientId);
  if (!client) return json({ error: "not_found", message: M.notFound }, 404);
  const last = await latestIntake(env, auth.clientId);
  return json({
    status: client.status,
    statusLabel: STATUS_LABELS[client.status],
    latestIntakeVersion: last ? last.version : 0,
    history: await history(env, auth.clientId)
  });
}

export async function putLanguage(request, env, auth) {
  const b = await readJson(request, 512);
  if (!b || (b.language !== "sv" && b.language !== "en")) return json({ error: "bad_request", message: M.badRequest }, 400);
  await env.DB.prepare("UPDATE clients SET language = ?, updated_at = ? WHERE id = ?").bind(b.language, nowIso(), auth.clientId).run();
  return json({ ok: true, language: b.language });
}
