/* Admin endpoints. Phase 1: create and invite a client, list clients, resend an invite.
   Phase 3: the ScriptForge Growth Clients panel reads the list, opens an intake and marks it seen.
   Every handler here is reached only after the router has checked the admin role. */
import { STATUS_LABELS, getConfig } from "./config.js";
import { eraseAfter } from "./gdpr.js";
import { createLoginToken, isAdminEmail, signinUrl, verifyLink } from "./auth.js";
import { composeEmail, sendMail } from "./mail.js";
import { json, lang, newId, normEmail, nowIso, readJson, validEmail } from "./util.js";

const M = {
  badRequest: { sv: "Ogiltig förfrågan.", en: "Bad request." },
  name: { sv: "Skriv kundens namn (högst 200 tecken).", en: "Enter the client's name (200 characters at most)." },
  email: { sv: "Skriv en giltig e-postadress.", en: "Enter a valid email address." },
  adminEmail: { sv: "Den adressen är en admin-adress.", en: "That address is an admin address." },
  exists: { sv: "Det finns redan en kund med den e-postadressen.", en: "A client with that email already exists." },
  notFound: { sv: "Kunden finns inte.", en: "Client not found." }
};

function publicClient(c) {
  return {
    id: c.id,
    name: c.name,
    email: c.email,
    language: c.language,
    status: c.status,
    statusLabel: STATUS_LABELS[c.status],
    createdAt: c.created_at,
    invitedAt: c.invited_at,
    lastLoginAt: c.last_login_at,
    latestIntakeVersion: c.latest_intake_version || 0,
    latestSubmittedAt: c.latest_submitted_at || null,
    latestBrainVersion: c.latest_brain_version || 0,
    brainBuiltFromIntakeVersion: c.brain_built_from || 0,
    seenIntakeVersion: c.admin_seen_intake_version || 0,
    leftAt: c.left_at || null,
    eraseAfter: eraseAfter(c.left_at, RETENTION),
    /* "New": a submitted intake Harry has not opened yet in ScriptForge. */
    isNew: (c.latest_intake_version || 0) > (c.admin_seen_intake_version || 0),
    /* The latest intake is newer than the one the current brain was built from (phase 4). */
    hasNewIntake: (c.latest_intake_version || 0) > (c.brain_built_from || 0)
  };
}

async function sendInvite(env, cfg, client) {
  const token = await createLoginToken(env, cfg, {
    email: client.email,
    role: "client",
    clientId: client.id,
    purpose: "invite"
  });
  const mail = composeEmail("invite", cfg, {
    link: verifyLink(cfg, token),
    name: client.name,
    language: client.language,
    signinUrl: signinUrl(cfg, "client")
  });
  try {
    await sendMail(cfg, env, { to: client.email, ...mail });
    await env.DB.prepare("UPDATE clients SET invited_at = ?, updated_at = ? WHERE id = ?")
      .bind(nowIso(), nowIso(), client.id)
      .run();
    return true;
  } catch (e) {
    console.error("invite email failed: " + e.message);
    return false;
  }
}

export async function createClient(request, env, cfg) {
  const b = await readJson(request);
  if (!b) return json({ error: "bad_request", message: M.badRequest }, 400);
  const name = typeof b.name === "string" ? b.name.trim() : "";
  const email = normEmail(b.email);
  if (!name || name.length > 200) return json({ error: "name", message: M.name }, 400);
  if (!validEmail(email)) return json({ error: "email", message: M.email }, 400);
  if (isAdminEmail(cfg, email)) return json({ error: "admin_email", message: M.adminEmail }, 400);
  const existing = await env.DB.prepare("SELECT id FROM clients WHERE email = ?").bind(email).first();
  if (existing) return json({ error: "exists", message: M.exists, clientId: existing.id }, 409);

  const t = nowIso();
  const client = { id: newId("cl", 12), name, email, language: lang(b.language) };
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO clients (id, name, email, language, status, created_at, updated_at) VALUES (?, ?, ?, ?, 'invited', ?, ?)"
    ).bind(client.id, name, email, client.language, t, t),
    env.DB.prepare(
      "INSERT INTO status_history (client_id, status, changed_at, changed_by) VALUES (?, 'invited', ?, 'admin')"
    ).bind(client.id, t)
  ]);
  const emailSent = await sendInvite(env, cfg, client);
  const row = await env.DB.prepare("SELECT * FROM clients WHERE id = ?").bind(client.id).first();
  return json({ ok: true, emailSent, client: publicClient(row) }, 201);
}

export async function resendInvite(env, cfg, clientId) {
  const client = await env.DB.prepare("SELECT id, name, email, language FROM clients WHERE id = ?").bind(clientId).first();
  if (!client) return json({ error: "not_found", message: M.notFound }, 404);
  const emailSent = await sendInvite(env, cfg, client);
  return json({ ok: true, emailSent });
}

let RETENTION = 6;
export async function listClients(env) {
  RETENTION = getConfig(env).retentionMonths;
  const rows = await env.DB.prepare(
    `SELECT c.*,
       (SELECT MAX(version) FROM intakes i WHERE i.client_id = c.id) AS latest_intake_version,
       (SELECT submitted_at FROM intakes i2 WHERE i2.client_id = c.id ORDER BY version DESC LIMIT 1) AS latest_submitted_at,
       (SELECT MAX(version) FROM brains b WHERE b.client_id = c.id) AS latest_brain_version,
       (SELECT built_from_intake_version FROM brains b2 WHERE b2.client_id = c.id ORDER BY version DESC LIMIT 1) AS brain_built_from
     FROM clients c ORDER BY c.created_at DESC`
  ).all();
  const clients = (rows.results || []).map(publicClient);
  return json({ clients, newCount: clients.filter((c) => c.isNew).length, checkedAt: nowIso() });
}

/* POST /admin/clients/:clientId/seen {version}: Harry has opened this intake version in
   ScriptForge, so its "New" badge goes away. Never moves backwards. */
export async function markSeen(request, env, clientId) {
  const b = await readJson(request, 256);
  const version = b && Number.isInteger(b.version) && b.version > 0 ? b.version : 0;
  if (!version) return json({ error: "bad_request", message: M.badRequest }, 400);
  const r = await env.DB.prepare(
    "UPDATE clients SET admin_seen_intake_version = MAX(admin_seen_intake_version, ?) WHERE id = ? RETURNING admin_seen_intake_version AS seen"
  ).bind(version, clientId).first();
  if (!r) return json({ error: "not_found", message: M.notFound }, 404);
  return json({ ok: true, seenIntakeVersion: r.seen });
}

/* GET /admin/intake/:clientId : the latest submitted intake (or the draft if nothing is
   submitted yet) plus the client's files. Files are opened through /api/vault/files/:id,
   which checks the admin session. */
export async function getIntakeAdmin(env, clientId) {
  const client = await env.DB.prepare("SELECT id, name, email, status, language FROM clients WHERE id = ?").bind(clientId).first();
  if (!client) return json({ error: "not_found", message: M.notFound }, 404);
  const last = await env.DB.prepare("SELECT version, data, submitted_at FROM intakes WHERE client_id = ? ORDER BY version DESC LIMIT 1").bind(clientId).first();
  const draft = last ? null : await env.DB.prepare("SELECT data, updated_at FROM intake_drafts WHERE client_id = ?").bind(clientId).first();
  const files = await env.DB.prepare("SELECT id, section, mime, size, original_name, duration_s, created_at FROM files WHERE client_id = ? ORDER BY created_at ASC").bind(clientId).all();
  const consent = await env.DB.prepare("SELECT version, language, accepted_at FROM consents WHERE client_id = ? ORDER BY id DESC LIMIT 1").bind(clientId).first();
  const versions = await env.DB.prepare("SELECT version, submitted_at FROM intakes WHERE client_id = ? ORDER BY version DESC").bind(clientId).all();
  return json({
    client: { id: client.id, name: client.name, email: client.email, language: client.language, status: client.status, statusLabel: STATUS_LABELS[client.status] },
    consent: consent ? { version: consent.version, language: consent.language, acceptedAt: consent.accepted_at } : null,
    versions: (versions.results || []).map((v) => ({ version: v.version, submittedAt: v.submitted_at })),
    source: last ? "submitted" : draft ? "draft" : "none",
    version: last ? last.version : 0,
    submittedAt: last ? last.submitted_at : null,
    intake: last ? JSON.parse(last.data) : draft ? JSON.parse(draft.data) : null,
    files: (files.results || []).map((f) => ({ id: f.id, section: f.section, mime: f.mime, size: f.size, name: f.original_name, duration: f.duration_s == null ? null : f.duration_s, createdAt: f.created_at, url: "/api/vault/files/" + f.id }))
  });
}
