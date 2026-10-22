/* Studio (admin) endpoints. Every handler here is reached only after the router has checked
   the admin session and the same-origin rule.
   Server rules: production cannot start before the client approved one hook and the script;
   delivery needs a project in production; every script, hook and message is stripped of
   em dashes before it is saved. */
import { clientLink, makeKey } from "./auth.js";
import { EXTRA_USAGE_NOTE, FIELDS, PACKAGES, REVISION_DAYS, CHANGE_ROUNDS_INCLUDED } from "./config.js";
import { ADMIN_MAX, ADMIN_TYPES, MAX_DELIVERY_FILES, downloadResponse, extOf, r2Key, safeName } from "./files.js";
import { addMessage, alertAdmin, loadBundle, mailLater, nudgeClient, productLine, proposalIntro, revisionOpen, shapeProposal } from "./projects.js";
import { json, newId, nowIso, nowMs, readJson, text } from "./util.js";

const BAD = { error: "bad_request", message: "Bad request." };
const WARN = [
  /\bguarantee(d|s)?\b/i, /\b100 ?%/, /\bcures?\b/i, /\bclinically proven\b/i, /\bscientifically proven\b/i,
  /\bdoctor[- ]approved\b/i, /\brisk[- ]free\b/i, /\bmiracle\b/i, /\bno side effects\b/i, /\bget rich\b/i,
  /\b(lose|drop) \d+ ?(kg|lbs?|pounds|kilos)\b/i, /(^|\s)#1(\s|$)/, /\bbest in the world\b/i, /\bovernight results?\b/i
];

export function lint(strings) {
  const hits = new Set();
  for (const s of strings) for (const re of WARN) { const m = re.exec(s); if (m) hits.add(m[0].trim()); }
  return [...hits];
}

function parseProposal(body) {
  const hooksIn = Array.isArray(body.hooks) ? body.hooks : [];
  const hooks = hooksIn.slice(0, 3).map((h) => text(h, 300));
  const s = body.script && typeof body.script === "object" ? body.script : {};
  const script = {
    hook: text(s.hook, 600), problem: text(s.problem, 600), solution: text(s.solution, 600), benefit: text(s.benefit, 600), cta: text(s.cta, 400)
  };
  const recommended = parseInt(body.recommended, 10);
  if (hooks.length !== 3 || hooks.some((h) => !h)) return { error: "Write all three hook options." };
  if (![1, 2, 3].includes(recommended)) return { error: "Choose the recommended hook (1 to 3)." };
  if (Object.values(script).some((v) => !v)) return { error: "Fill in every part of the script: hook, problem, solution, benefit, call to action." };
  return { hooks, recommended, script, warnings: lint([...hooks, ...Object.values(script)]) };
}

function needsYou(row) {
  return ["brief_received", "changes_requested", "approved"].includes(row.status) || row.last_author === "client";
}

export async function listProjects(env) {
  const rows = (await env.DB.prepare(
    `SELECT p.id, p.brand, p.contact_name, p.email, p.package, p.status, p.delivery_date, p.created_at, p.updated_at,
            (SELECT author FROM messages m WHERE m.project_id = p.id ORDER BY m.id DESC LIMIT 1) AS last_author
     FROM projects p WHERE p.status != 'draft' ORDER BY p.updated_at DESC LIMIT 300`
  ).all()).results || [];
  return json({
    projects: rows.map((r) => ({
      id: r.id, brand: r.brand, contactName: r.contact_name, email: r.email, package: PACKAGES[r.package].label, status: r.status,
      deliveryDate: r.delivery_date, createdAt: r.created_at, updatedAt: r.updated_at, needsYou: needsYou(r)
    }))
  });
}

export async function getProjectAdmin(env, cfg, id) {
  const b = await loadBundle(env, id);
  if (!b) return json({ error: "not_found", message: "Not found." }, 404);
  const p = b.project;
  const brief = JSON.parse(p.brief);
  return json({
    project: {
      id: p.id, brand: p.brand, contactName: p.contact_name, email: p.email, status: p.status, package: { key: p.package, ...PACKAGES[p.package] },
      createdAt: p.created_at, deliveryDate: p.delivery_date, approvedAt: p.approved_at, approvedHook: p.approved_hook, approvedProposalId: p.approved_proposal_id,
      productionStartedAt: p.production_started_at, deliveredAt: p.delivered_at, revisionUntil: p.revision_until, revisionOpen: revisionOpen(p),
      revisionsUsed: p.revisions_used, videos: p.videos_delivered, deliveryLink: p.delivery_link, deliveryNote: p.delivery_note,
      rounds: { used: p.change_rounds_used, allowed: CHANGE_ROUNDS_INCLUDED + p.extra_rounds },
      productionLocked: !p.approved_at,
      clientLink: clientLink(cfg, await makeKey(cfg, p.id, p.key_version))
    },
    brief: FIELDS.filter((f) => brief[f.key]).map((f) => ({
      label: f.label, value: f.options ? f.options[brief[f.key]] || brief[f.key] : f.type === "package" ? PACKAGES[brief[f.key]].label : brief[f.key]
    })),
    briefRaw: brief,
    intro: proposalIntro(brief, p.contact_name),
    proposals: b.proposals.map(shapeProposal),
    files: b.files,
    messages: b.messages.map((m) => ({ id: m.id, author: m.author, kind: m.kind, body: m.body, at: m.created_at })),
    revisionDays: REVISION_DAYS
  });
}

export async function createProposal(request, env, id) {
  const body = await readJson(request, 32 * 1024);
  if (!body) return json(BAD, 400);
  const project = await env.DB.prepare("SELECT status FROM projects WHERE id = ?").bind(id).first();
  if (!project) return json({ error: "not_found", message: "Not found." }, 404);
  if (!["brief_received", "changes_requested", "script_review"].includes(project.status))
    return json({ error: "locked", message: "A proposal cannot be added at this stage." }, 409);
  const parsed = parseProposal(body);
  if (parsed.error) return json({ error: "validation", message: parsed.error }, 400);
  const n = await env.DB.prepare("SELECT COALESCE(MAX(version), 0) AS v FROM proposals WHERE project_id = ?").bind(id).first();
  const pid = newId("pp", 10);
  await env.DB.prepare("INSERT INTO proposals (id, project_id, version, hooks, recommended, script, status, created_at) VALUES (?, ?, ?, ?, ?, ?, 'draft', ?)")
    .bind(pid, id, n.v + 1, JSON.stringify(parsed.hooks), parsed.recommended, JSON.stringify(parsed.script), nowIso())
    .run();
  return json({ ok: true, id: pid, version: n.v + 1, warnings: parsed.warnings }, 201);
}

export async function updateProposal(request, env, pid) {
  const body = await readJson(request, 32 * 1024);
  if (!body) return json(BAD, 400);
  const parsed = parseProposal(body);
  if (parsed.error) return json({ error: "validation", message: parsed.error }, 400);
  const r = await env.DB.prepare("UPDATE proposals SET hooks = ?, recommended = ?, script = ? WHERE id = ? AND status = 'draft' RETURNING id")
    .bind(JSON.stringify(parsed.hooks), parsed.recommended, JSON.stringify(parsed.script), pid)
    .first();
  if (!r) return json({ error: "locked", message: "Only a draft can be edited." }, 409);
  return json({ ok: true, warnings: parsed.warnings });
}

export async function publishProposal(request, env, cfg, ctx, pid) {
  const body = (await readJson(request, 2 * 1024)) || {};
  const prop = await env.DB.prepare("SELECT * FROM proposals WHERE id = ?").bind(pid).first();
  if (!prop || prop.status !== "draft") return json({ error: "locked", message: "Only a draft can be published." }, 409);
  const project = await env.DB.prepare("SELECT * FROM projects WHERE id = ?").bind(prop.project_id).first();
  if (!["brief_received", "changes_requested", "script_review"].includes(project.status))
    return json({ error: "locked", message: "A proposal cannot be published at this stage." }, 409);
  const warnings = lint([...JSON.parse(prop.hooks), ...Object.values(JSON.parse(prop.script))]);
  if (warnings.length && body.ackWarnings !== true)
    return json({ error: "warnings", message: "Check these phrases before publishing: " + warnings.join(", "), warnings }, 409);
  const t = nowIso();
  await env.DB.batch([
    env.DB.prepare("UPDATE proposals SET status = 'superseded' WHERE project_id = ? AND status = 'published'").bind(project.id),
    env.DB.prepare("UPDATE proposals SET status = 'published', published_at = ? WHERE id = ?").bind(t, pid),
    env.DB.prepare("UPDATE projects SET status = 'script_review', updated_at = ? WHERE id = ?").bind(t, project.id)
  ]);
  await addMessage(env, project.id, "system", "proposal", prop.version === 1 ? "Your hooks and script are ready for your approval." : "An updated version of your hooks and script is ready (version " + prop.version + ").");
  if (body.notify === true) await nudgeClient(ctx, cfg, env, project, "Your hooks and script are ready for your approval.");
  return json({ ok: true });
}

export async function startProduction(env, cfg, ctx, id, body) {
  const p = await env.DB.prepare("SELECT * FROM projects WHERE id = ?").bind(id).first();
  if (!p) return json({ error: "not_found", message: "Not found." }, 404);
  if (!p.approved_at || !p.approved_proposal_id)
    return json({ error: "production_locked", message: "Production stays locked until the client approves one hook and one script." }, 409);
  const t = nowIso();
  const r = await env.DB.prepare("UPDATE projects SET status = 'in_production', production_started_at = ?, updated_at = ? WHERE id = ? AND status = 'approved' RETURNING id").bind(t, t, id).first();
  if (!r) return json({ error: "locked", message: "Production can start only from the approved stage." }, 409);
  await addMessage(env, id, "system", "production", "Production has started.");
  if (body.notify === true) await nudgeClient(ctx, cfg, env, p, "Production on your videos has started.");
  return json({ ok: true });
}

export async function grantExtraRound(env, id) {
  const r = await env.DB.prepare("UPDATE projects SET extra_rounds = extra_rounds + 1, updated_at = ? WHERE id = ? AND status IN ('script_review','changes_requested','brief_received') RETURNING id").bind(nowIso(), id).first();
  if (!r) return json({ error: "locked", message: "Extra rounds apply before approval." }, 409);
  await addMessage(env, id, "system", "round", "An extra concept change round was added to your project.");
  return json({ ok: true });
}

export async function adminMessage(request, env, cfg, ctx, id) {
  const body = await readJson(request, 8 * 1024);
  const note = body ? text(body.text, 2000) : "";
  if (!note) return json({ error: "text", message: "Write a message first." }, 400);
  const p = await env.DB.prepare("SELECT * FROM projects WHERE id = ?").bind(id).first();
  if (!p) return json({ error: "not_found", message: "Not found." }, 404);
  await addMessage(env, id, "admin", "message", note);
  if (body.notify === true) await nudgeClient(ctx, cfg, env, p, "You have a new message in your dashboard.");
  return json({ ok: true });
}

export async function uploadDeliveryFile(request, env, id, url) {
  const p = await env.DB.prepare("SELECT status FROM projects WHERE id = ?").bind(id).first();
  if (!p) return json({ error: "not_found", message: "Not found." }, 404);
  const name = safeName(url.searchParams.get("name"));
  const ext = extOf(name);
  if (!ADMIN_TYPES[ext]) return json({ error: "type", message: "This file type is not accepted." }, 415);
  const len = parseInt(request.headers.get("Content-Length") || "0", 10);
  if (!len || !request.body) return json({ error: "length", message: "Empty file." }, 411);
  if (len > ADMIN_MAX) return json({ error: "too_large", message: "Files over 95 MB: paste a delivery link instead." }, 413);
  const n = await env.DB.prepare("SELECT COUNT(*) AS n FROM files WHERE project_id = ? AND area = 'delivery'").bind(id).first();
  if (n.n >= MAX_DELIVERY_FILES) return json({ error: "too_many", message: "File limit reached." }, 409);
  const fileId = newId("f", 14);
  await env.FILES.put(r2Key(id, fileId), request.body, { httpMetadata: { contentType: ADMIN_TYPES[ext].mime } });
  await env.DB.prepare("INSERT INTO files (id, project_id, area, name, ext, size, r2_key, created_at) VALUES (?, ?, 'delivery', ?, ?, ?, ?, ?)")
    .bind(fileId, id, name, ext, len, r2Key(id, fileId), nowIso())
    .run();
  return json({ ok: true, file: { id: fileId, name, size: len } }, 201);
}

export async function deleteFile(env, fid) {
  const f = await env.DB.prepare("SELECT * FROM files WHERE id = ?").bind(fid).first();
  if (!f) return json({ error: "not_found", message: "Not found." }, 404);
  await env.FILES.delete(f.r2_key);
  await env.DB.prepare("DELETE FROM files WHERE id = ?").bind(fid).run();
  return json({ ok: true });
}

export async function downloadAdminFile(env, fid) {
  const f = await env.DB.prepare("SELECT * FROM files WHERE id = ?").bind(fid).first();
  if (!f) return json({ error: "not_found", message: "Not found." }, 404);
  const object = await env.FILES.get(f.r2_key);
  if (!object) return json({ error: "not_found", message: "Not found." }, 404);
  return downloadResponse(object, f);
}

/* The delivery message follows the agreed template and fills itself from the intake. */
export function deliveryMessage({ contactName, brief, pkg, videos, hookText, link }) {
  const lines = [
    "Hi " + contactName + ",",
    "",
    "Your AI UGC video for " + productLine(brief) + " is ready.",
    "",
    "Package: " + pkg.label,
    "Videos delivered: " + videos,
    "Approved hook used: " + hookText
  ];
  if (link) lines.push("Delivery link: " + link);
  lines.push(
    "",
    "Your final vertical video files, captions, and usage details are available in this dashboard.",
    "",
    "This delivery includes " + pkg.revisionLabel + ", depending on your package. Please send any revision requests within " + REVISION_DAYS + " days of delivery.",
    "",
    "Your included usage rights are: " + pkg.usage + ". " + EXTRA_USAGE_NOTE,
    "",
    "Thank you for working with TAHA Studio Labs."
  );
  return lines.join("\n");
}

export async function deliver(request, env, cfg, ctx, id) {
  const body = await readJson(request, 8 * 1024);
  if (!body) return json(BAD, 400);
  const p = await env.DB.prepare("SELECT * FROM projects WHERE id = ?").bind(id).first();
  if (!p) return json({ error: "not_found", message: "Not found." }, 404);
  if (p.status !== "in_production") return json({ error: "locked", message: "Delivery needs a project that is in production." }, 409);
  if (!p.approved_proposal_id) return json({ error: "production_locked", message: "No approved hook and script on record." }, 409);
  const videos = parseInt(body.videos, 10);
  if (!(videos >= 1 && videos <= 50)) return json({ error: "videos", message: "Enter the number of videos delivered (1 to 50)." }, 400);
  let link = text(body.link, 500);
  if (link && !/^https:\/\/[^\s]+$/i.test(link)) return json({ error: "link", message: "The delivery link must start with https://" }, 400);
  const files = await env.DB.prepare("SELECT COUNT(*) AS n FROM files WHERE project_id = ? AND area = 'delivery'").bind(id).first();
  if (!files.n && !link) return json({ error: "nothing", message: "Upload at least one file or add a delivery link." }, 400);
  const note = text(body.note, 1000);
  const prop = await env.DB.prepare("SELECT hooks FROM proposals WHERE id = ?").bind(p.approved_proposal_id).first();
  const hookText = JSON.parse(prop.hooks)[p.approved_hook - 1];
  const t = nowIso();
  const until = new Date(nowMs() + REVISION_DAYS * 86400000).toISOString();
  const r = await env.DB.prepare(
    "UPDATE projects SET status = 'delivered', delivered_at = ?, revision_until = ?, videos_delivered = ?, delivery_link = ?, delivery_note = ?, updated_at = ? WHERE id = ? AND status = 'in_production' RETURNING id"
  )
    .bind(t, until, videos, link || null, note || null, t, id)
    .first();
  if (!r) return json({ error: "locked", message: "Delivery needs a project that is in production." }, 409);
  await addMessage(env, id, "admin", "delivery", deliveryMessage({ contactName: p.contact_name, brief: JSON.parse(p.brief), pkg: PACKAGES[p.package], videos, hookText, link }));
  if (body.notify === true) await nudgeClient(ctx, cfg, env, p, "Your AI UGC videos are ready.");
  return json({ ok: true, revisionUntil: until });
}

export async function extendRevisions(request, env, id) {
  const body = await readJson(request, 1024);
  const days = body ? parseInt(body.days, 10) : 0;
  if (!(days >= 1 && days <= 30)) return json({ error: "days", message: "Choose 1 to 30 days." }, 400);
  const p = await env.DB.prepare("SELECT revision_until, status FROM projects WHERE id = ?").bind(id).first();
  if (!p || p.status !== "delivered") return json({ error: "locked", message: "Only a delivered project has a revision window." }, 409);
  const from = Math.max(nowMs(), Date.parse(p.revision_until));
  await env.DB.prepare("UPDATE projects SET revision_until = ?, updated_at = ? WHERE id = ?").bind(new Date(from + days * 86400000).toISOString(), nowIso(), id).run();
  await addMessage(env, id, "system", "window", "The revision window was extended by " + days + " day" + (days === 1 ? "" : "s") + ".");
  return json({ ok: true });
}

export async function resetLink(env, cfg, id) {
  const p = await env.DB.prepare("UPDATE projects SET key_version = key_version + 1 WHERE id = ? RETURNING *").bind(id).first();
  if (!p) return json({ error: "not_found", message: "Not found." }, 404);
  return json({ ok: true, clientLink: clientLink(cfg, await makeKey(cfg, p.id, p.key_version)) });
}

export async function closeProject(env, id) {
  const r = await env.DB.prepare("UPDATE projects SET status = 'closed', updated_at = ? WHERE id = ? AND status != 'draft' RETURNING id").bind(nowIso(), id).first();
  if (!r) return json({ error: "not_found", message: "Not found." }, 404);
  await addMessage(env, id, "system", "closed", "This project is closed. Thank you for working with TAHA Studio Labs.");
  return json({ ok: true });
}

/* Erase: files from R2 first, then the project row, which cascades to everything else. */
export async function eraseProject(env, id) {
  const rows = (await env.DB.prepare("SELECT r2_key FROM files WHERE project_id = ?").bind(id).all()).results || [];
  for (let i = 0; i < rows.length; i += 100) await env.FILES.delete(rows.slice(i, i + 100).map((r) => r.r2_key));
  const r = await env.DB.prepare("DELETE FROM projects WHERE id = ? RETURNING id").bind(id).first();
  if (!r) return json({ error: "not_found", message: "Not found." }, 404);
  return json({ ok: true, erased: id, filesRemoved: rows.length });
}

export { mailLater, alertAdmin };
