/* V2 Part H: language review by a human (spec section 10). Markets step 2: every language
   marked review in assets/growth-languages.js (Swedish and Spanish) goes this way; Harry
   approves the others (English, French and the two Pidgins) himself.

   Every text field of a reviewed campaign becomes a language item with three kinds of stored
   version, never overwritten: machine (frozen when sent), reviewed (the specialist's) and
   approved (Harry's). Production (client review, Your content, the landing page, Send to
   ScriptForge) reads the approved text; a field without it is "Waiting for language review".

   Admin:
   POST /admin/lang/:clientId/:campaignId/send     {paths?, note?, due?} queue fields
   GET  /admin/lang/:clientId/:campaignId          items with every version, the approved map
                                                   and the production gate
   POST /admin/lang/:clientId/:campaignId/accept-all
   POST /admin/lang/item/:itemId                   {action: accept | approve | send_back | keep,
                                                    text?, comment?, reason?}
   GET, POST /admin/lang/notes/:clientId           language notes per client
   PUT  /admin/lang/setting/:clientId              {review: true|false} Always send this client's
                                                   reviewed-language campaigns to review
   Reviewer (own assigned clients only):
   GET  /review/queue
   GET, PUT /review/item/:itemId                   read, save a draft
   POST /review/item/:itemId/done, /flag */
import { applyApproved, checkReviewed, getPath, langFields } from "../../../assets/growth-langfields.js";
import { composeLangNotice, composeLangQueue, sendMail } from "./mail.js";
import { json, newId, nowIso, readJson, sha256hex } from "./util.js";
import { LANGUAGES, reviewLanguage } from "../../../assets/growth-languages.js";

const M = {
  badRequest: { sv: "Ogiltig förfrågan.", en: "Bad request." },
  notFound: { sv: "Hittades inte.", en: "Not found." },
  english: { sv: "Kampanjens språk granskas inte av en granskare. Bara svenska och spanska texter går till språkgranskning.", en: "This campaign's language is not sent to a reviewer. Only Swedish and Spanish texts go to language review." },
  state: { sv: "Texten är inte i rätt läge för det.", en: "The text is not in the right state for that." },
  reason: { sv: "Skriv ett skäl (minst 5 tecken).", en: "Give a reason (at least 5 characters)." },
  comment: { sv: "Skriv en kommentar.", en: "Write a comment." },
  checks: { sv: "Texten klarar inte kontrollerna.", en: "The text does not pass the checks." },
  open: { sv: "Alla texter är inte klara, eller någon är flaggad.", en: "Not every text is done, or one is flagged." }
};
const all = async (env, sql, ...args) => (await env.DB.prepare(sql).bind(...args).all()).results || [];
const hash = async (t) => (await sha256hex("lang:" + String(t))).slice(0, 24);
const clean = (v, max) => (typeof v === "string" ? v.replace(/\r\n/g, "\n").slice(0, max) : "");
const OPEN_STATES = ["waiting", "sent_back", "flagged", "done", "outdated"];

async function campaignDoc(env, clientId, campaignId) {
  const r = await env.DB.prepare("SELECT data FROM campaigns WHERE client_id = ? AND campaign_id = ?").bind(clientId, campaignId).first();
  return r ? JSON.parse(r.data) : null;
}

/* The language a reviewer checks for this campaign (sv, es), or null. */
const reviewLang = (doc) => (doc ? reviewLanguage(doc.language) : null);
/* "sv,es" contains the code as a whole entry (SQL side of the same test). */
const HAS_LANG = "(',' || m.languages || ',') LIKE '%,' || ? || ',%'";

async function reviewerFor(env, clientId, language) {
  if (!language) return null;
  return env.DB.prepare(
    "SELECT m.* FROM team_members m JOIN team_access a ON a.member_id = m.id WHERE a.client_id = ? AND m.active = 1 AND m.agreement_at IS NOT NULL AND " + HAS_LANG + " ORDER BY m.created_at ASC LIMIT 1"
  ).bind(clientId, language).first();
}

async function latestVersions(env, itemIds) {
  if (!itemIds.length) return {};
  const rows = [];
  for (let i = 0; i < itemIds.length; i += 80) {
    const part = itemIds.slice(i, i + 80);
    rows.push(...(await all(env, "SELECT * FROM lang_versions WHERE item_id IN (" + part.map(() => "?").join(",") + ") ORDER BY id ASC", ...part)));
  }
  const by = {};
  rows.forEach((v) => {
    const b = (by[v.item_id] = by[v.item_id] || { machine: null, reviewed: null, approved: null, history: [] });
    b[v.kind] = v;
    b.history.push({ kind: v.kind, text: v.text, author: v.author, round: v.round, at: v.at });
  });
  return by;
}

/* Queue fields for review. Used by the Send button and, with "Always review", when a Swedish
   or Spanish campaign with a Visual Pack is saved. Returns {created, requeued, member}. */
export async function queueFields(env, cfg, ctx, clientId, campaignId, doc, { paths, note, due } = {}) {
  const fields = langFields(doc).filter((f) => !paths || paths.includes(f.path));
  const existing = await all(env, "SELECT * FROM lang_items WHERE client_id = ? AND campaign_id = ?", clientId, campaignId);
  const byPath = {};
  existing.forEach((i) => { byPath[i.field_path] = i; });
  const vers = await latestVersions(env, existing.map((i) => i.id));
  const language = reviewLang(doc) || "sv";
  const member = await reviewerFor(env, clientId, language);
  const t = nowIso();
  const stmts = [];
  let created = 0, requeued = 0;
  for (const f of fields) {
    const h = await hash(f.text);
    const it = byPath[f.path];
    if (!it) {
      const id = newId("li", 14);
      created++;
      stmts.push(env.DB.prepare("INSERT INTO lang_items (id, client_id, campaign_id, field_path, output_key, label, kind, max_len, language, state, round, member_id, due, note, sent_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'waiting', 1, ?, ?, ?, ?, ?)")
        .bind(id, clientId, campaignId, f.path, f.outputKey, f.label, f.kind, f.maxLen, language, member ? member.id : null, due || null, note || null, t, t));
      stmts.push(env.DB.prepare("INSERT INTO lang_versions (item_id, client_id, kind, text, author, round, base_hash, at) VALUES (?, ?, 'machine', ?, 'scriptforge', 1, ?, ?)").bind(id, clientId, f.text, h, t));
      continue;
    }
    const machine = vers[it.id] && vers[it.id].machine;
    const same = machine && machine.base_hash === h;
    if (same && it.state !== "outdated") {
      if (note || due) stmts.push(env.DB.prepare("UPDATE lang_items SET note = COALESCE(?, note), due = COALESCE(?, due), updated_at = ? WHERE id = ?").bind(note || null, due || null, t, it.id));
      continue;
    }
    /* The machine text changed since it was sent: freeze the new one and start a new round. */
    requeued++;
    const round = it.round + 1;
    stmts.push(env.DB.prepare("UPDATE lang_items SET state = 'waiting', round = ?, member_id = COALESCE(member_id, ?), draft = NULL, flag_comment = NULL, note = COALESCE(?, note), due = COALESCE(?, due), sent_at = ?, updated_at = ? WHERE id = ?")
      .bind(round, member ? member.id : null, note || null, due || null, t, t, it.id));
    stmts.push(env.DB.prepare("INSERT INTO lang_versions (item_id, client_id, kind, text, author, round, base_hash, at) VALUES (?, ?, 'machine', ?, 'scriptforge', ?, ?, ?)").bind(it.id, clientId, f.text, round, h, t));
  }
  for (let i = 0; i < stmts.length; i += 90) await env.DB.batch(stmts.slice(i, i + 90));
  if ((created || requeued) && member) {
    const n = await env.DB.prepare("SELECT COUNT(*) AS n FROM lang_items WHERE member_id = ? AND state IN ('waiting','sent_back')").bind(member.id).first();
    const mail = composeLangQueue(cfg, { name: member.name, count: n.n, link: cfg.siteOrigin + "/grow/review/", language: String(member.languages || "sv").split(",").includes("sv") ? "sv" : "en" });
    ctx.waitUntil(sendMail(cfg, env, { to: member.email, ...mail }).catch((e) => console.error("lang queue email failed: " + e.message)));
  }
  return { created, requeued, member: member ? { id: member.id, name: member.name } : null };
}

/* Called after a campaign is saved: a sent text that was edited or regenerated becomes
   Outdated, and with Always review a new Swedish or Spanish campaign with visuals is queued. */
export async function afterCampaignSaved(env, cfg, ctx, clientId, doc) {
  const items = await all(env, "SELECT * FROM lang_items WHERE client_id = ? AND campaign_id = ?", clientId, doc.campaignId);
  if (items.length) {
    const vers = await latestVersions(env, items.map((i) => i.id));
    const stmts = [];
    const t = nowIso();
    for (const it of items) {
      const cur = getPath(doc, it.field_path);
      const machine = vers[it.id] && vers[it.id].machine;
      if (typeof cur !== "string" || !machine) continue;
      if ((await hash(cur)) !== machine.base_hash && it.state !== "outdated") {
        stmts.push(env.DB.prepare("UPDATE lang_items SET state = 'outdated', updated_at = ? WHERE id = ?").bind(t, it.id));
        stmts.push(env.DB.prepare("INSERT INTO lang_log (client_id, member_id, item_id, action, detail, at) VALUES (?, NULL, ?, 'outdated', 'machine text changed after sending', ?)").bind(clientId, it.id, t));
      }
    }
    if (stmts.length) await env.DB.batch(stmts);
    return;
  }
  const c = await env.DB.prepare("SELECT lang_review FROM clients WHERE id = ?").bind(clientId).first();
  if (c && c.lang_review === 1 && reviewLang(doc) && Array.isArray(doc.visuals) && doc.visuals.length) {
    await queueFields(env, cfg, ctx, clientId, doc.campaignId, doc, {});
  }
}

/* {fieldPath: text} of every approved (or kept) text that is still current. */
export async function approvedMap(env, clientId, campaignId) {
  const items = await all(env, "SELECT id, field_path FROM lang_items WHERE client_id = ? AND campaign_id = ? AND state IN ('approved','kept')", clientId, campaignId);
  const vers = await latestVersions(env, items.map((i) => i.id));
  const map = {};
  items.forEach((i) => { const a = vers[i.id] && vers[i.id].approved; if (a) map[i.field_path] = a.text; });
  return map;
}

/* Is language review required for this campaign, and how much is still open? */
export async function langGate(env, clientId, campaignId, doc) {
  const items = await all(env, "SELECT state FROM lang_items WHERE client_id = ? AND campaign_id = ?", clientId, campaignId);
  const c = await env.DB.prepare("SELECT lang_review FROM clients WHERE id = ?").bind(clientId).first();
  const required = items.length > 0 || (!!c && c.lang_review === 1 && !!reviewLang(doc));
  const approved = items.filter((i) => i.state === "approved" || i.state === "kept").length;
  const pending = required ? (items.length ? items.length - approved : langFields(doc).length) : 0;
  return { required, total: items.length, approved, pending };
}

/* The campaign as production must use it: approved, reviewed text in place of the machine text. */
export async function productionDoc(env, clientId, campaignId, doc) {
  return applyApproved(doc, await approvedMap(env, clientId, campaignId));
}

/* For the routes that put text in front of clients or customers: blocks when language review
   is required and texts are still open, unless Harry gives a reason (logged). */
export async function checkLangGate(env, clientId, campaignId, doc, override) {
  const g = await langGate(env, clientId, campaignId, doc);
  if (!g.required || g.pending === 0) return null;
  const reason = typeof override === "string" ? override.trim().slice(0, 500) : "";
  if (reason.length >= 5) {
    await env.DB.prepare("INSERT INTO lang_log (client_id, member_id, item_id, action, detail, at) VALUES (?, NULL, NULL, 'gate_override', ?, ?)").bind(clientId, campaignId + ": " + reason, nowIso()).run();
    return null;
  }
  return json({ error: "lang_pending", message: { sv: "Väntar på språkgranskning (" + g.pending + " texter).", en: "Waiting for language review (" + g.pending + " texts)." }, gate: g }, 409);
}

function itemOut(i, v) {
  const b = v || {};
  return {
    id: i.id,
    campaignId: i.campaign_id,
    path: i.field_path,
    outputKey: i.output_key,
    label: i.label,
    kind: i.kind,
    language: i.language || "sv",
    maxLen: i.max_len,
    state: i.state,
    round: i.round,
    memberId: i.member_id || null,
    due: i.due || null,
    note: i.note || "",
    flagComment: i.flag_comment || "",
    reviewerNote: i.reviewer_note || "",
    sentAt: i.sent_at,
    updatedAt: i.updated_at,
    machine: b.machine ? b.machine.text : "",
    reviewed: b.reviewed ? b.reviewed.text : null,
    reviewedBy: b.reviewed ? b.reviewed.author : null,
    approved: b.approved ? b.approved.text : null,
    history: b.history || []
  };
}

/* ---------- admin ---------- */

export async function sendLang(request, env, cfg, ctx, clientId, campaignId) {
  const doc = await campaignDoc(env, clientId, campaignId);
  if (!doc) return json({ error: "not_found", message: M.notFound }, 404);
  if (!reviewLang(doc)) return json({ error: "english", message: M.english }, 400);
  const b = (await readJson(request, 16 * 1024)) || {};
  const paths = Array.isArray(b.paths) ? b.paths.map(String).slice(0, 200) : null;
  const note = clean(b.note, 1000) || null;
  const due = /^\d{4}-\d{2}-\d{2}$/.test(String(b.due || "")) ? b.due : null;
  const out = await queueFields(env, cfg, ctx, clientId, campaignId, doc, { paths, note, due });
  const r = await getLang(env, clientId, campaignId);
  const d = await r.json();
  return json(Object.assign(d, { sent: out }), 201);
}

export async function getLang(env, clientId, campaignId) {
  const doc = await campaignDoc(env, clientId, campaignId);
  if (!doc) return json({ error: "not_found", message: M.notFound }, 404);
  const items = await all(env, "SELECT * FROM lang_items WHERE client_id = ? AND campaign_id = ? ORDER BY rowid ASC", clientId, campaignId);
  const vers = await latestVersions(env, items.map((i) => i.id));
  const c = await env.DB.prepare("SELECT lang_review FROM clients WHERE id = ?").bind(clientId).first();
  const rl = reviewLang(doc);
  const reviewer = await reviewerFor(env, clientId, rl);
  return json({
    language: doc.language,
    /* The language a reviewer checks (sv or es), or null when Harry approves it himself. */
    reviewLanguage: rl,
    reviewLanguageName: rl ? LANGUAGES[rl].name : null,
    swedish: rl === "sv",
    alwaysReview: !!c && c.lang_review === 1,
    reviewer: reviewer ? { id: reviewer.id, name: reviewer.name } : null,
    items: items.map((i) => itemOut(i, vers[i.id])),
    approved: await approvedMap(env, clientId, campaignId),
    gate: await langGate(env, clientId, campaignId, doc),
    fields: langFields(doc).length
  });
}

async function approveText(env, it, text, author) {
  const t = nowIso();
  const machine = await env.DB.prepare("SELECT base_hash FROM lang_versions WHERE item_id = ? AND kind = 'machine' ORDER BY id DESC LIMIT 1").bind(it.id).first();
  return [
    env.DB.prepare("INSERT INTO lang_versions (item_id, client_id, kind, text, author, round, base_hash, at) VALUES (?, ?, 'approved', ?, ?, ?, ?, ?)").bind(it.id, it.client_id, text, author, it.round, machine ? machine.base_hash : "", t)
  ];
}

export async function decideItem(request, env, itemId) {
  const it = await env.DB.prepare("SELECT * FROM lang_items WHERE id = ?").bind(itemId).first();
  if (!it) return json({ error: "not_found", message: M.notFound }, 404);
  const b = await readJson(request, 32 * 1024);
  if (!b || typeof b.action !== "string") return json({ error: "bad_request", message: M.badRequest }, 400);
  const v = (await latestVersions(env, [it.id]))[it.id] || {};
  const t = nowIso();
  let stmts = [];
  if (b.action === "accept") {
    if (it.state !== "done" || !v.reviewed) return json({ error: "state", message: M.state }, 409);
    stmts = await approveText(env, it, v.reviewed.text, "harry");
    stmts.push(env.DB.prepare("UPDATE lang_items SET state = 'approved', updated_at = ? WHERE id = ?").bind(t, it.id));
  } else if (b.action === "approve") {
    if (!["done", "flagged", "waiting", "sent_back"].includes(it.state)) return json({ error: "state", message: M.state }, 409);
    const text = clean(b.text, 20000);
    const doc = await campaignDoc(env, it.client_id, it.campaign_id);
    const brain = await env.DB.prepare("SELECT data FROM brains WHERE client_id = ? ORDER BY version DESC LIMIT 1").bind(it.client_id).first();
    const avoid = brain ? ((JSON.parse(brain.data).words || {}).avoid || []) : [];
    const problems = checkReviewed(text, v.machine ? v.machine.text : "", { maxLen: it.max_len, avoid });
    if (problems.length) return json({ error: "checks", message: M.checks, problems }, 400);
    stmts = await approveText(env, it, text, "harry");
    stmts.push(env.DB.prepare("UPDATE lang_items SET state = 'approved', updated_at = ? WHERE id = ?").bind(t, it.id));
    void doc;
  } else if (b.action === "send_back") {
    if (!["done", "flagged"].includes(it.state)) return json({ error: "state", message: M.state }, 409);
    const comment = clean(b.comment, 1000).trim();
    if (!comment) return json({ error: "comment", message: M.comment }, 400);
    stmts.push(env.DB.prepare("UPDATE lang_items SET state = 'sent_back', round = round + 1, flag_comment = ?, updated_at = ? WHERE id = ?").bind(comment, t, it.id));
  } else if (b.action === "keep") {
    if (it.state === "outdated" || !v.machine) return json({ error: "state", message: M.state }, 409);
    const reason = clean(b.reason, 500).trim();
    if (reason.length < 5) return json({ error: "reason", message: M.reason }, 400);
    stmts = await approveText(env, it, v.machine.text, "harry (machine text kept)");
    stmts.push(env.DB.prepare("UPDATE lang_items SET state = 'kept', updated_at = ? WHERE id = ?").bind(t, it.id));
    stmts.push(env.DB.prepare("INSERT INTO lang_log (client_id, member_id, item_id, action, detail, at) VALUES (?, NULL, ?, 'keep_machine', ?, ?)").bind(it.client_id, it.id, reason, t));
  } else return json({ error: "bad_request", message: M.badRequest }, 400);
  stmts.push(env.DB.prepare("INSERT INTO lang_log (client_id, member_id, item_id, action, detail, at) VALUES (?, NULL, ?, ?, NULL, ?)").bind(it.client_id, it.id, "harry_" + b.action, t));
  await env.DB.batch(stmts);
  const now = await env.DB.prepare("SELECT * FROM lang_items WHERE id = ?").bind(it.id).first();
  return json({ ok: true, item: itemOut(now, (await latestVersions(env, [it.id]))[it.id]) });
}

export async function acceptAll(env, clientId, campaignId) {
  const items = await all(env, "SELECT * FROM lang_items WHERE client_id = ? AND campaign_id = ?", clientId, campaignId);
  const open = items.filter((i) => ["waiting", "sent_back", "flagged", "outdated"].includes(i.state));
  if (open.length) return json({ error: "open", message: M.open, open: open.length }, 409);
  const done = items.filter((i) => i.state === "done");
  const vers = await latestVersions(env, done.map((i) => i.id));
  const t = nowIso();
  let stmts = [];
  for (const it of done) {
    if (!vers[it.id] || !vers[it.id].reviewed) continue;
    stmts = stmts.concat(await approveText(env, it, vers[it.id].reviewed.text, "harry"));
    stmts.push(env.DB.prepare("UPDATE lang_items SET state = 'approved', updated_at = ? WHERE id = ?").bind(t, it.id));
  }
  stmts.push(env.DB.prepare("INSERT INTO lang_log (client_id, member_id, item_id, action, detail, at) VALUES (?, NULL, NULL, 'accept_all', ?, ?)").bind(clientId, campaignId + ": " + done.length, t));
  for (let i = 0; i < stmts.length; i += 90) await env.DB.batch(stmts.slice(i, i + 90));
  return getLang(env, clientId, campaignId);
}

export async function getNotes(env, clientId) {
  const rows = await all(env, "SELECT id, preferred, reason, from_item AS fromItem, at FROM lang_notes WHERE client_id = ? ORDER BY id DESC", clientId);
  return json({ notes: rows });
}

export async function postNote(request, env, clientId) {
  const c = await env.DB.prepare("SELECT 1 FROM clients WHERE id = ?").bind(clientId).first();
  if (!c) return json({ error: "not_found", message: M.notFound }, 404);
  const b = await readJson(request, 4096);
  if (!b) return json({ error: "bad_request", message: M.badRequest }, 400);
  if (b.delete) {
    await env.DB.prepare("DELETE FROM lang_notes WHERE id = ? AND client_id = ?").bind(parseInt(b.delete, 10) || 0, clientId).run();
    return getNotes(env, clientId);
  }
  const preferred = clean(b.preferred, 300).trim();
  if (!preferred) return json({ error: "bad_request", message: M.badRequest }, 400);
  await env.DB.prepare("INSERT INTO lang_notes (client_id, preferred, reason, from_item, at) VALUES (?, ?, ?, ?, ?)")
    .bind(clientId, preferred.replace(/\u2014/g, ", "), clean(b.reason, 500).trim().replace(/\u2014/g, ", ") || null, typeof b.fromItem === "string" ? b.fromItem.slice(0, 40) : null, nowIso()).run();
  return getNotes(env, clientId);
}

export async function putSetting(request, env, clientId) {
  const b = await readJson(request, 256);
  if (!b || typeof b.review !== "boolean") return json({ error: "bad_request", message: M.badRequest }, 400);
  const r = await env.DB.prepare("UPDATE clients SET lang_review = ? WHERE id = ?").bind(b.review ? 1 : 0, clientId).run();
  if (!r.meta || !r.meta.changes) return json({ error: "not_found", message: M.notFound }, 404);
  return json({ ok: true, alwaysReview: b.review });
}

/* ---------- reviewer ---------- */

async function memberItem(env, auth, itemId) {
  if (!/^li_[a-z0-9]{4,32}$/.test(itemId)) return null;
  return env.DB.prepare(
    "SELECT i.* FROM lang_items i JOIN team_access a ON a.client_id = i.client_id AND a.member_id = ? JOIN team_members m ON m.id = a.member_id WHERE i.id = ? AND (i.member_id = ? OR i.member_id IS NULL) AND " + HAS_LANG.replace("?", "i.language")
  ).bind(auth.memberId, itemId, auth.memberId).first();
}

async function contextFor(env, clientId) {
  const brain = await env.DB.prepare("SELECT data FROM brains WHERE client_id = ? ORDER BY version DESC LIMIT 1").bind(clientId).first();
  const b = brain ? JSON.parse(brain.data) : {};
  return { voice: (b.voice && b.voice.summary) || "", use: (b.words && b.words.use) || [], avoid: (b.words && b.words.avoid) || [] };
}

export async function reviewQueue(env, auth) {
  const rows = await all(env,
    "SELECT i.*, c.name AS client_name, json_extract(k.data, '$.name') AS campaign_name FROM lang_items i JOIN team_access a ON a.client_id = i.client_id AND a.member_id = ? JOIN team_members m ON m.id = a.member_id JOIN clients c ON c.id = i.client_id LEFT JOIN campaigns k ON k.client_id = i.client_id AND k.campaign_id = i.campaign_id WHERE (i.member_id = ? OR i.member_id IS NULL) AND " + HAS_LANG.replace("?", "i.language") + " AND i.state IN ('waiting','sent_back','done','flagged') ORDER BY i.sent_at ASC, i.rowid ASC",
    auth.memberId, auth.memberId);
  const vers = await latestVersions(env, rows.map((r) => r.id));
  const ctxs = {};
  for (const r of rows) if (!ctxs[r.client_id]) ctxs[r.client_id] = await contextFor(env, r.client_id);
  return json({
    member: { name: auth.name, email: auth.email },
    items: rows.map((r) => Object.assign(itemOut(r, vers[r.id]), { clientName: r.client_name, campaignName: r.campaign_name || "", draft: r.draft || null, context: ctxs[r.client_id] }))
  });
}

export async function reviewItem(request, env, auth, itemId, method) {
  const it = await memberItem(env, auth, itemId);
  if (!it) return json({ error: "not_found", message: M.notFound }, 404);
  const t = nowIso();
  if (method === "GET") {
    await env.DB.prepare("INSERT INTO lang_log (client_id, member_id, item_id, action, detail, at) VALUES (?, ?, ?, 'view', NULL, ?)").bind(it.client_id, auth.memberId, it.id, t).run();
    const v = (await latestVersions(env, [it.id]))[it.id];
    return json({ item: Object.assign(itemOut(it, v), { draft: it.draft || null, context: await contextFor(env, it.client_id) }) });
  }
  if (!["waiting", "sent_back", "flagged"].includes(it.state)) return json({ error: "state", message: M.state }, 409);
  const b = await readJson(request, 32 * 1024);
  if (!b) return json({ error: "bad_request", message: M.badRequest }, 400);
  await env.DB.batch([
    env.DB.prepare("UPDATE lang_items SET draft = ?, reviewer_note = COALESCE(?, reviewer_note), updated_at = ? WHERE id = ?").bind(clean(b.draft, 20000), typeof b.note === "string" ? clean(b.note, 1000) : null, t, it.id),
    env.DB.prepare("INSERT INTO lang_log (client_id, member_id, item_id, action, detail, at) VALUES (?, ?, ?, 'draft', NULL, ?)").bind(it.client_id, auth.memberId, it.id, t)
  ]);
  return json({ ok: true, savedAt: t });
}

async function noticeIfCampaignDone(env, cfg, ctx, it) {
  const rows = await all(env, "SELECT state FROM lang_items WHERE client_id = ? AND campaign_id = ?", it.client_id, it.campaign_id);
  if (rows.some((r) => r.state === "waiting" || r.state === "sent_back")) return;
  const c = await env.DB.prepare("SELECT name FROM clients WHERE id = ?").bind(it.client_id).first();
  const done = rows.filter((r) => ["done", "approved", "kept"].includes(r.state)).length;
  const flagged = rows.filter((r) => r.state === "flagged").length;
  const mail = composeLangNotice(cfg, { company: (c && c.name) || "A client", done, total: rows.length, flagged, link: cfg.growthPanelUrl });
  ctx.waitUntil(sendMail(cfg, env, { to: cfg.tahaEmail, ...mail }).catch((e) => console.error("lang notice failed: " + e.message)));
}

export async function reviewDone(request, env, cfg, ctx, auth, itemId) {
  const it = await memberItem(env, auth, itemId);
  if (!it) return json({ error: "not_found", message: M.notFound }, 404);
  if (!["waiting", "sent_back", "flagged"].includes(it.state)) return json({ error: "state", message: M.state }, 409);
  const b = await readJson(request, 32 * 1024);
  if (!b) return json({ error: "bad_request", message: M.badRequest }, 400);
  const text = clean(b.text, 20000);
  const v = (await latestVersions(env, [it.id]))[it.id] || {};
  const c = await contextFor(env, it.client_id);
  const problems = checkReviewed(text, v.machine ? v.machine.text : "", { maxLen: it.max_len, avoid: c.avoid });
  if (problems.length) return json({ error: "checks", message: M.checks, problems }, 400);
  const t = nowIso();
  await env.DB.batch([
    env.DB.prepare("INSERT INTO lang_versions (item_id, client_id, kind, text, author, round, base_hash, at) VALUES (?, ?, 'reviewed', ?, ?, ?, ?, ?)").bind(it.id, it.client_id, text, auth.name + " <" + auth.email + ">", it.round, v.machine ? v.machine.base_hash : "", t),
    env.DB.prepare("UPDATE lang_items SET state = 'done', member_id = ?, draft = NULL, reviewer_note = ?, updated_at = ? WHERE id = ?").bind(auth.memberId, typeof b.note === "string" ? clean(b.note, 1000) || null : it.reviewer_note, t, it.id),
    env.DB.prepare("INSERT INTO lang_log (client_id, member_id, item_id, action, detail, at) VALUES (?, ?, ?, 'done', NULL, ?)").bind(it.client_id, auth.memberId, it.id, t)
  ]);
  await noticeIfCampaignDone(env, cfg, ctx, it);
  return json({ ok: true, state: "done" });
}

export async function reviewFlag(request, env, cfg, ctx, auth, itemId) {
  const it = await memberItem(env, auth, itemId);
  if (!it) return json({ error: "not_found", message: M.notFound }, 404);
  if (!["waiting", "sent_back"].includes(it.state)) return json({ error: "state", message: M.state }, 409);
  const b = await readJson(request, 4096);
  const comment = clean(b && b.comment, 1000).trim();
  if (!comment) return json({ error: "comment", message: M.comment }, 400);
  const t = nowIso();
  await env.DB.batch([
    env.DB.prepare("UPDATE lang_items SET state = 'flagged', member_id = ?, flag_comment = ?, updated_at = ? WHERE id = ?").bind(auth.memberId, comment.replace(/\u2014/g, ", "), t, it.id),
    env.DB.prepare("INSERT INTO lang_log (client_id, member_id, item_id, action, detail, at) VALUES (?, ?, ?, 'flag', NULL, ?)").bind(it.client_id, auth.memberId, it.id, t)
  ]);
  await noticeIfCampaignDone(env, cfg, ctx, it);
  return json({ ok: true, state: "flagged" });
}
