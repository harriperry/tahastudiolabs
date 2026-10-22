/* Client side logic: the intake, the private dashboard and every action a client can take.
   Rules enforced here on the server, whatever the browser sends:
   1. Production stays locked until the client has approved one hook and confirmed the script.
   2. Pre-production changes are limited to CHANGE_ROUNDS_INCLUDED rounds (plus rounds Harry grants).
   3. Revisions are accepted only inside the 7 day window after delivery and within the package limit. */
import { authProject, allow, clientLink, makeKey } from "./auth.js";
import {
  CHANGE_ROUNDS_INCLUDED, EXTRA_USAGE_NOTE, FIELDS, GOALS, PACKAGES, REVISION_DAYS, STATUS_LABELS, stepOf
} from "./config.js";
import { CLIENT_TYPES, MAX_CLIENT_ASSETS, downloadResponse, extOf, magicOk, r2Key, safeName } from "./files.js";
import { composeAdminBrief, composeAdminEvent, composeClientLink, composeNudge, sendMail } from "./mail.js";
import { clip, json, newId, normEmail, nowIso, nowMs, readJson, sha256hex, text, validEmail } from "./util.js";

const MSG = {
  bad: "Bad request.",
  notFound: "Not found.",
  tooMany: "Too many attempts. Please wait a while and try again.",
  locked: "That is not possible at this stage of the project.",
  server: "Something went wrong on our side. Please try again."
};

export function ipOf(request) {
  return request.headers.get("CF-Connecting-IP") || "local";
}

/* ---------- mail helpers (never let a mail failure break a request) ---------- */

export function mailLater(ctx, cfg, env, to, mail) {
  const run = sendMail(cfg, env, { to, ...mail }).catch((e) => console.error("mail failed: " + e.message));
  if (ctx && ctx.waitUntil) ctx.waitUntil(run);
  return run;
}

export function alertAdmin(ctx, cfg, env, project, what) {
  const mail = composeAdminEvent(cfg, { brand: project.brand, what, adminLink: cfg.studioBase + "#" + project.id });
  return mailLater(ctx, cfg, env, cfg.tahaEmail, mail);
}

export async function nudgeClient(ctx, cfg, env, project, what) {
  const link = clientLink(cfg, await makeKey(cfg, project.id, project.key_version));
  const mail = composeNudge(cfg, { contactName: project.contact_name, brand: project.brand, link, what });
  return mailLater(ctx, cfg, env, project.email, mail);
}

export async function addMessage(env, projectId, author, kind, body) {
  await env.DB.prepare("INSERT INTO messages (project_id, author, kind, body, created_at) VALUES (?, ?, ?, ?, ?)")
    .bind(projectId, author, kind, body, nowIso())
    .run();
  await env.DB.prepare("UPDATE projects SET updated_at = ? WHERE id = ?").bind(nowIso(), projectId).run();
}

/* ---------- meta and validation ---------- */

export function meta(cfg) {
  return json({
    fields: FIELDS,
    packages: Object.fromEntries(
      Object.entries(PACKAGES).map(([k, p]) => [k, { label: p.label, usage: p.usageShort, revision: p.revisionLabel }])
    ),
    usageNote: EXTRA_USAGE_NOTE,
    changeRounds: CHANGE_ROUNDS_INCLUDED,
    revisionDays: REVISION_DAYS,
    maxAssets: MAX_CLIENT_ASSETS,
    accept: Object.keys(CLIENT_TYPES),
    privacyUrl: cfg.privacyUrl
  });
}

function validDate(s) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(s + "T00:00:00Z");
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== s) return false;
  const now = Date.now();
  return d.getTime() > now - 2 * 86400000 && d.getTime() < now + 3 * 365 * 86400000;
}

export function validateBrief(body) {
  const values = {};
  const errors = {};
  for (const f of FIELDS) {
    if (f.showIf && body[f.showIf.key] !== f.showIf.value) continue;
    const raw = body[f.key];
    if (f.type === "text" || f.type === "textarea") {
      const v = text(raw, f.max);
      if (!v && f.required) errors[f.key] = "Please fill this in.";
      if (v) values[f.key] = v;
    } else if (f.type === "email") {
      const v = normEmail(raw);
      if (!validEmail(v)) errors[f.key] = "Enter a valid email address.";
      else values[f.key] = v;
    } else if (f.type === "select") {
      if (typeof raw === "string" && Object.prototype.hasOwnProperty.call(f.options, raw)) values[f.key] = raw;
      else if (f.required) errors[f.key] = "Please choose one.";
    } else if (f.type === "package") {
      if (typeof raw === "string" && Object.prototype.hasOwnProperty.call(PACKAGES, raw)) values[f.key] = raw;
      else errors[f.key] = "Please choose a package.";
    } else if (f.type === "date") {
      if (typeof raw === "string" && raw) {
        if (validDate(raw)) values[f.key] = raw;
        else errors[f.key] = "Enter a valid date.";
      }
    }
  }
  if (body.consent !== true) errors.consent = "Please confirm that you have read the privacy policy.";
  return { values, errors };
}

/* ---------- intake ---------- */

export async function submitBrief(request, env, cfg) {
  /* Two limits: a generous one on attempts (typos are fine) and a strict one on real briefs. */
  if (!(await allow(env, "attempt:" + ipOf(request), 60))) return json({ error: "rate_limited", message: MSG.tooMany }, 429);
  const body = await readJson(request, 64 * 1024);
  if (!body) return json({ error: "bad_request", message: MSG.bad }, 400);
  /* Honeypot: real people never see this field. Pretend it worked. */
  if (body.company_url) return json({ ok: true, key: "pj_fake.fake" }, 201);
  const { values, errors } = validateBrief(body);
  if (Object.keys(errors).length) return json({ error: "validation", fields: errors }, 400);
  if (!(await allow(env, "submit:" + ipOf(request), cfg.submitsPerIpHour))) return json({ error: "rate_limited", message: MSG.tooMany }, 429);
  const id = newId("pj", 10);
  const t = nowIso();
  await env.DB.prepare(
    `INSERT INTO projects (id, key_version, brand, contact_name, email, package, status, brief, delivery_date, consent_at, created_at, updated_at)
     VALUES (?, 1, ?, ?, ?, ?, 'draft', ?, ?, ?, ?, ?)`
  )
    .bind(id, values.brand, values.contact_name, values.email, values.package, JSON.stringify(values), values.delivery_date || null, t, t, t)
    .run();
  return json({ ok: true, key: await makeKey(cfg, id, 1) }, 201);
}

export async function uploadAsset(request, env, cfg, url) {
  const project = await authProject(request, env, cfg);
  if (!project) return json({ error: "unauthorized", message: MSG.notFound }, 401);
  if (project.status === "in_production" || project.status === "delivered" || project.status === "closed")
    return json({ error: "locked", message: MSG.locked }, 409);
  const name = safeName(url.searchParams.get("name"));
  const ext = extOf(name);
  const rule = CLIENT_TYPES[ext];
  if (!rule) return json({ error: "type", message: "This file type is not accepted." }, 415);
  const len = parseInt(request.headers.get("Content-Length") || "0", 10);
  if (!len) return json({ error: "length", message: "Empty file." }, 411);
  if (len > rule.max) return json({ error: "too_large", message: "This file is too large." }, 413);
  const count = await env.DB.prepare("SELECT COUNT(*) AS n FROM files WHERE project_id = ? AND area = 'asset'").bind(project.id).first();
  if (count.n >= MAX_CLIENT_ASSETS) return json({ error: "too_many", message: "File limit reached." }, 409);
  const bytes = new Uint8Array(await request.arrayBuffer());
  if (!bytes.length || bytes.length > rule.max) return json({ error: "too_large", message: "This file is too large." }, 413);
  if (!magicOk(rule.magic, bytes)) return json({ error: "type", message: "The file does not match its type." }, 415);
  const fileId = newId("f", 14);
  await env.FILES.put(r2Key(project.id, fileId), bytes, { httpMetadata: { contentType: rule.mime } });
  await env.DB.prepare("INSERT INTO files (id, project_id, area, name, ext, size, r2_key, created_at) VALUES (?, ?, 'asset', ?, ?, ?, ?, ?)")
    .bind(fileId, project.id, name, ext, bytes.length, r2Key(project.id, fileId), nowIso())
    .run();
  return json({ ok: true, file: { id: fileId, name, size: bytes.length } }, 201);
}

/* Moves a draft to "brief received" once, then sends the client link and the alert to Harry.
   Used by the client's Finish button and by the cron sweep for drafts left open. */
export async function finalizeProject(env, cfg, ctx, projectId) {
  const t = nowIso();
  const row = await env.DB.prepare(
    "UPDATE projects SET status = 'brief_received', finalized_at = ?, updated_at = ? WHERE id = ? AND status = 'draft' RETURNING *"
  )
    .bind(t, t, projectId)
    .first();
  if (!row) return false;
  await addMessage(env, projectId, "system", "brief", "Brief received. You will get hook options and a script here within 24 to 48 hours.");
  const link = clientLink(cfg, await makeKey(cfg, row.id, row.key_version));
  mailLater(ctx, cfg, env, row.email, composeClientLink(cfg, { contactName: row.contact_name, brand: row.brand, link }));
  const files = (await env.DB.prepare("SELECT name, size FROM files WHERE project_id = ? AND area = 'asset' ORDER BY created_at").bind(row.id).all()).results || [];
  mailLater(ctx, cfg, env, cfg.tahaEmail, composeAdminBrief(cfg, { project: row, brief: JSON.parse(row.brief), files, adminLink: cfg.studioBase + "#" + row.id }));
  return true;
}

export async function finalize(request, env, cfg, ctx) {
  const project = await authProject(request, env, cfg);
  if (!project) return json({ error: "unauthorized", message: MSG.notFound }, 401);
  await finalizeProject(env, cfg, ctx, project.id);
  return json({ ok: true });
}

/* Cron: a client who submitted but whose browser never called finalize still reaches Harry. */
export async function sweepDrafts(env, cfg, ctx) {
  const cutoff = new Date(nowMs() - 10 * 60 * 1000).toISOString();
  const rows = (await env.DB.prepare("SELECT id FROM projects WHERE status = 'draft' AND created_at < ?").bind(cutoff).all()).results || [];
  for (const r of rows) await finalizeProject(env, cfg, ctx, r.id);
}

/* A client who lost the email asks for the link again. The reply is always the same. */
export async function requestLink(request, env, cfg, ctx) {
  const body = await readJson(request, 2 * 1024);
  const email = body ? normEmail(body.email) : "";
  if (!validEmail(email)) return json({ error: "email", message: "Enter a valid email address." }, 400);
  const okIp = await allow(env, "link-ip:" + ipOf(request), 20);
  const okEmail = await allow(env, "link-email:" + email, cfg.linkRequestsPerEmailHour);
  if (!okIp || !okEmail) return json({ error: "rate_limited", message: MSG.tooMany }, 429);
  const run = (async () => {
    const rows = (await env.DB.prepare("SELECT * FROM projects WHERE email = ? AND status NOT IN ('draft','closed') ORDER BY created_at DESC LIMIT 5").bind(email).all()).results || [];
    for (const p of rows) {
      const link = clientLink(cfg, await makeKey(cfg, p.id, p.key_version));
      await sendMail(cfg, env, { to: p.email, ...composeClientLink(cfg, { contactName: p.contact_name, brand: p.brand, link, again: true }) }).catch((e) =>
        console.error("mail failed: " + e.message)
      );
    }
  })();
  if (ctx && ctx.waitUntil) ctx.waitUntil(run);
  return json({ ok: true, message: "If a project exists for that address, we have sent the private link again. Check your inbox." });
}

/* ---------- views ---------- */

export function goalPhrase(brief) {
  const g = GOALS[brief.goal];
  if (!g) return "reach your goal";
  return brief.goal === "other" ? clip(brief.goal_other || "reach your goal", 120) : g.phrase;
}

export function productLine(brief) {
  return clip(String(brief.product || "").split("\n")[0], 100);
}

export function proposalIntro(brief, contactName) {
  return (
    "Hi " + contactName + ", thank you for sharing your brief for " + productLine(brief) + ". Based on your goal to " + goalPhrase(brief) +
    " and your target audience of " + clip(brief.audience || "", 140) + ", here are three hook directions for your AI UGC video:"
  );
}

export function shapeProposal(r) {
  return {
    id: r.id,
    version: r.version,
    status: r.status,
    hooks: JSON.parse(r.hooks),
    recommended: r.recommended,
    script: JSON.parse(r.script),
    publishedAt: r.published_at
  };
}

export function revisionOpen(p, now = Date.now()) {
  const pkg = PACKAGES[p.package];
  return p.status === "delivered" && !!p.revision_until && now <= Date.parse(p.revision_until) && p.revisions_used < pkg.revisionRounds;
}

export async function loadBundle(env, id) {
  const project = await env.DB.prepare("SELECT * FROM projects WHERE id = ?").bind(id).first();
  if (!project) return null;
  const [proposals, messages, files] = await env.DB.batch([
    env.DB.prepare("SELECT * FROM proposals WHERE project_id = ? ORDER BY version").bind(id),
    env.DB.prepare("SELECT id, author, kind, body, created_at FROM messages WHERE project_id = ? ORDER BY id").bind(id),
    env.DB.prepare("SELECT id, area, name, ext, size, created_at FROM files WHERE project_id = ? ORDER BY created_at").bind(id)
  ]);
  return { project, proposals: proposals.results || [], messages: messages.results || [], files: files.results || [] };
}

export function clientView(cfg, b) {
  const p = b.project;
  const pkg = PACKAGES[p.package];
  const brief = JSON.parse(p.brief);
  const visible = b.proposals.filter((x) => x.status === "published" || x.status === "approved");
  const current = visible.length ? shapeProposal(visible[visible.length - 1]) : null;
  const allowed = CHANGE_ROUNDS_INCLUDED + p.extra_rounds;
  const approvedProposal = b.proposals.find((x) => x.id === p.approved_proposal_id);
  const hookUsed = approvedProposal ? JSON.parse(approvedProposal.hooks)[p.approved_hook - 1] : null;
  return {
    project: {
      id: p.id,
      brand: p.brand,
      contactName: p.contact_name,
      email: p.email,
      status: p.status,
      statusLabel: STATUS_LABELS[p.status],
      step: stepOf(p.status),
      createdAt: p.created_at,
      deliveryDate: p.delivery_date,
      package: { key: p.package, label: pkg.label, usage: pkg.usageShort, revision: pkg.revisionLabel }
    },
    brief: FIELDS.filter((f) => brief[f.key]).map((f) => ({
      label: f.label,
      value: f.options ? f.options[brief[f.key]] || brief[f.key] : f.type === "package" ? PACKAGES[brief[f.key]].label : brief[f.key]
    })),
    files: {
      assets: b.files.filter((f) => f.area === "asset").map((f) => ({ id: f.id, name: f.name, size: f.size })),
      delivery: b.files.filter((f) => f.area === "delivery").map((f) => ({ id: f.id, name: f.name, size: f.size }))
    },
    proposal: current && { ...current, intro: proposalIntro(brief, p.contact_name) },
    approval: p.approved_at ? { hook: p.approved_hook, hookText: hookUsed, at: p.approved_at } : null,
    rounds: { used: p.change_rounds_used, allowed, left: Math.max(0, allowed - p.change_rounds_used) },
    production: { locked: !p.approved_at, started: !!p.production_started_at },
    delivery: p.delivered_at && {
      videos: p.videos_delivered,
      link: p.delivery_link,
      note: p.delivery_note,
      deliveredAt: p.delivered_at,
      revisionUntil: p.revision_until,
      revisionOpen: revisionOpen(p),
      revisionsUsed: p.revisions_used,
      revisionsAllowed: pkg.revisionRounds,
      usage: pkg.usage,
      usageNote: EXTRA_USAGE_NOTE
    },
    messages: b.messages.map((m) => ({ id: m.id, author: m.author, kind: m.kind, body: m.body, at: m.created_at }))
  };
}

export async function getProject(request, env, cfg) {
  const project = await authProject(request, env, cfg);
  if (!project) return json({ error: "unauthorized", message: MSG.notFound }, 401);
  return json(clientView(cfg, await loadBundle(env, project.id)));
}

/* ---------- client actions ---------- */

async function guard(request, env, cfg) {
  const project = await authProject(request, env, cfg);
  if (!project) return { res: json({ error: "unauthorized", message: MSG.notFound }, 401) };
  const body = await readJson(request, 16 * 1024);
  if (!body) return { res: json({ error: "bad_request", message: MSG.bad }, 400) };
  return { project, body };
}

export async function approve(request, env, cfg, ctx) {
  const g = await guard(request, env, cfg);
  if (g.res) return g.res;
  const { project, body } = g;
  const hook = parseInt(body.hook, 10);
  if (project.status !== "script_review") return json({ error: "locked", message: MSG.locked }, 409);
  if (![1, 2, 3].includes(hook)) return json({ error: "hook", message: "Choose one of the three hooks." }, 400);
  if (body.confirmScript !== true) return json({ error: "confirm", message: "Please confirm the script." }, 400);
  const prop = await env.DB.prepare("SELECT * FROM proposals WHERE id = ? AND project_id = ? AND status = 'published'").bind(String(body.proposalId || ""), project.id).first();
  if (!prop) return json({ error: "stale", message: "That version is no longer current. Refresh the page." }, 409);
  const t = nowIso();
  await env.DB.batch([
    env.DB.prepare("UPDATE proposals SET status = 'approved' WHERE id = ?").bind(prop.id),
    env.DB.prepare("UPDATE projects SET status = 'approved', approved_proposal_id = ?, approved_hook = ?, approved_at = ?, updated_at = ? WHERE id = ?").bind(prop.id, hook, t, t, project.id)
  ]);
  await addMessage(env, project.id, "client", "approval", "Approved hook " + hook + " and the script (version " + prop.version + ").");
  alertAdmin(ctx, cfg, env, project, "approved hook " + hook + " and the script. Production can start.");
  return json({ ok: true });
}

export async function requestChanges(request, env, cfg, ctx) {
  const g = await guard(request, env, cfg);
  if (g.res) return g.res;
  const { project, body } = g;
  const note = text(body.text, 2000);
  if (project.status !== "script_review") return json({ error: "locked", message: MSG.locked }, 409);
  if (note.length < 3) return json({ error: "text", message: "Tell us what you would like changed." }, 400);
  const allowed = CHANGE_ROUNDS_INCLUDED + project.extra_rounds;
  if (project.change_rounds_used >= allowed)
    return json({ error: "no_rounds", message: "Both included change rounds are used. You can still approve this version, or ask in the messages about an extra concept round." }, 409);
  const moved = await env.DB.prepare(
    "UPDATE projects SET status = 'changes_requested', change_rounds_used = change_rounds_used + 1, updated_at = ? WHERE id = ? AND status = 'script_review' AND change_rounds_used < ? RETURNING id"
  )
    .bind(nowIso(), project.id, allowed)
    .first();
  if (!moved) return json({ error: "locked", message: MSG.locked }, 409);
  await addMessage(env, project.id, "client", "changes_request", note);
  alertAdmin(ctx, cfg, env, project, "requested changes to the hooks or script (round " + (project.change_rounds_used + 1) + " of " + allowed + ").");
  return json({ ok: true });
}

export async function postClientMessage(request, env, cfg, ctx) {
  const g = await guard(request, env, cfg);
  if (g.res) return g.res;
  const { project, body } = g;
  const note = text(body.text, 2000);
  if (!note) return json({ error: "text", message: "Write a message first." }, 400);
  if (project.status === "draft") return json({ error: "locked", message: MSG.locked }, 409);
  if (!(await allow(env, "msg:" + project.id, 30))) return json({ error: "rate_limited", message: MSG.tooMany }, 429);
  await addMessage(env, project.id, "client", "message", note);
  alertAdmin(ctx, cfg, env, project, "sent a message.");
  return json({ ok: true });
}

export async function requestRevision(request, env, cfg, ctx) {
  const g = await guard(request, env, cfg);
  if (g.res) return g.res;
  const { project, body } = g;
  const note = text(body.text, 2000);
  if (project.status !== "delivered") return json({ error: "locked", message: MSG.locked }, 409);
  if (!revisionOpen(project))
    return json({ error: "closed", message: "The " + REVISION_DAYS + " day revision window has ended or all included revision rounds are used." }, 409);
  if (note.length < 3) return json({ error: "text", message: "Tell us what you would like revised." }, 400);
  const counted = await env.DB.prepare(
    "UPDATE projects SET revisions_used = revisions_used + 1, updated_at = ? WHERE id = ? AND status = 'delivered' AND revisions_used < ? RETURNING id"
  )
    .bind(nowIso(), project.id, PACKAGES[project.package].revisionRounds)
    .first();
  if (!counted) return json({ error: "closed", message: "All included revision rounds are used." }, 409);
  await addMessage(env, project.id, "client", "revision_request", note);
  alertAdmin(ctx, cfg, env, project, "requested a revision (" + (project.revisions_used + 1) + " of " + PACKAGES[project.package].revisionRounds + ").");
  return json({ ok: true });
}

export async function downloadClientFile(request, env, cfg, fileId) {
  const project = await authProject(request, env, cfg);
  if (!project) return json({ error: "unauthorized", message: MSG.notFound }, 401);
  const file = await env.DB.prepare("SELECT * FROM files WHERE id = ? AND project_id = ?").bind(fileId, project.id).first();
  if (!file) return json({ error: "not_found", message: MSG.notFound }, 404);
  const object = await env.FILES.get(file.r2_key);
  if (!object) return json({ error: "not_found", message: MSG.notFound }, 404);
  return downloadResponse(object, file);
}

export { sha256hex };
