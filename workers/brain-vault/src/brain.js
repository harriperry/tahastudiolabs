/* Phase 4: Business Brain versions.
   ScriptForge builds the brain in Harry's browser with his own AI key, lets him edit it, then
   posts the finished JSON here. The Vault never sees the key or the prompt: it only checks the
   document against brain.schema.json, gives it the next version number and stores it.

   POST /admin/brain/:clientId          {brain}  saves version N+1, status becomes Brain ready
   GET  /admin/brain/:clientId                   latest brain plus the list of versions
   GET  /admin/brain/:clientId/:version          one saved version (older versions stay readable) */
import { STATUS_LABELS } from "./config.js";
import { SCHEMAS } from "./schemas.js";
import { validate } from "./validate.js";
import { json, nowIso, readJson } from "./util.js";

const M = {
  badRequest: { sv: "Ogiltig förfrågan.", en: "Bad request." },
  notFound: { sv: "Hittades inte.", en: "Not found." },
  invalid: { sv: "Hjärnan följer inte schemat.", en: "The brain does not match the schema." },
  intake: { sv: "Den intagsversionen finns inte.", en: "That intake version does not exist." },
  key: {
    sv: "Texten ser ut att innehålla en API-nyckel. Den sparas inte i valvet.",
    en: "The text looks like it contains an API key. The Vault never stores keys."
  }
};

/* Statuses a new brain may move forward from. A client already in campaign production keeps
   that status when Harry saves a newer brain. */
const BEFORE_BRAIN = ["invited", "profile_in_progress", "submitted", "brain_ready"];

/* Common provider key shapes. If any appears anywhere in a brain, the save is refused. */
const KEY_PATTERNS = [/sk-ant-[A-Za-z0-9_-]{10,}/, /\bsk-[A-Za-z0-9]{32,}/, /AIza[0-9A-Za-z_-]{30,}/, /\bgsk_[A-Za-z0-9]{20,}/, /\bxai-[A-Za-z0-9]{20,}/];

export function looksLikeKey(text) {
  return KEY_PATTERNS.some((re) => re.test(text));
}

function stripDashes(v) {
  if (typeof v === "string") return v.replace(/\s*\u2014\s*/g, ", ");
  if (Array.isArray(v)) return v.map(stripDashes);
  if (v && typeof v === "object") {
    const o = {};
    for (const k of Object.keys(v)) o[k] = stripDashes(v[k]);
    return o;
  }
  return v;
}

function versionRow(r) {
  return {
    version: r.version,
    builtFromIntakeVersion: r.built_from_intake_version,
    createdAt: r.created_at,
    editedByHarry: !!(r.data && JSON.parse(r.data).editedByHarry)
  };
}

export async function saveBrain(request, env, clientId) {
  const client = await env.DB.prepare("SELECT id, status FROM clients WHERE id = ?").bind(clientId).first();
  if (!client) return json({ error: "not_found", message: M.notFound }, 404);
  const b = await readJson(request, 512 * 1024);
  if (!b || !b.brain || typeof b.brain !== "object" || Array.isArray(b.brain)) return json({ error: "bad_request", message: M.badRequest }, 400);
  if (looksLikeKey(JSON.stringify(b.brain))) return json({ error: "api_key", message: M.key }, 400);

  const from = b.brain.builtFromIntakeVersion;
  const intake = Number.isInteger(from)
    ? await env.DB.prepare("SELECT version FROM intakes WHERE client_id = ? AND version = ?").bind(clientId, from).first()
    : null;
  if (!intake) return json({ error: "intake", message: M.intake }, 400);

  const last = await env.DB.prepare("SELECT MAX(version) AS v FROM brains WHERE client_id = ?").bind(clientId).first();
  const version = ((last && last.v) || 0) + 1;
  const t = nowIso();
  /* The Vault owns the identity fields: client, version and time. */
  const doc = stripDashes(Object.assign({}, b.brain, { schemaVersion: "brain-1", clientId, brainVersion: version, createdAt: t }));
  const v = validate(SCHEMAS.brain, doc);
  if (!v.valid) return json({ error: "invalid", message: M.invalid, details: v.errors }, 400);

  const stmts = [
    env.DB.prepare("INSERT INTO brains (client_id, version, built_from_intake_version, data, created_at) VALUES (?, ?, ?, ?, ?)").bind(clientId, version, from, JSON.stringify(doc), t)
  ];
  let status = client.status;
  if (BEFORE_BRAIN.includes(client.status)) {
    status = "brain_ready";
    stmts.push(env.DB.prepare("UPDATE clients SET status = 'brain_ready', updated_at = ? WHERE id = ?").bind(t, clientId));
    if (client.status !== "brain_ready") {
      stmts.push(env.DB.prepare("INSERT INTO status_history (client_id, status, changed_at, changed_by) VALUES (?, 'brain_ready', ?, 'admin')").bind(clientId, t));
    }
  }
  await env.DB.batch(stmts);
  return json({ ok: true, brainVersion: version, createdAt: t, status, statusLabel: STATUS_LABELS[status], brain: doc }, 201);
}

export async function getBrains(env, clientId) {
  const client = await env.DB.prepare("SELECT id FROM clients WHERE id = ?").bind(clientId).first();
  if (!client) return json({ error: "not_found", message: M.notFound }, 404);
  const rows = await env.DB.prepare("SELECT version, built_from_intake_version, data, created_at FROM brains WHERE client_id = ? ORDER BY version DESC").bind(clientId).all();
  const list = rows.results || [];
  return json({ versions: list.map(versionRow), latest: list.length ? JSON.parse(list[0].data) : null });
}

export async function getBrainVersion(env, clientId, version) {
  const r = await env.DB.prepare("SELECT data FROM brains WHERE client_id = ? AND version = ?").bind(clientId, version).first();
  if (!r) return json({ error: "not_found", message: M.notFound }, 404);
  return json({ brain: JSON.parse(r.data) });
}
