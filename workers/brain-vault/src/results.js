/* V2 Part D: results tracking that feeds the next campaign.

   Client (portal):
   GET  /portal/results                     her delivered campaigns, the questions for her business
                                            type, what she answered, and which ones to ask now
   PUT  /portal/results/:campaignId         { values } or { skip: true }
   From the 25th of the campaign month, for two months, the portal asks "How did it go?" (unless
   Harry already filled the numbers in). Every
   answer is optional; she can skip. Harry gets an email (company and month only).

   Harry (panel):
   GET  /admin/results/:clientId            every campaign with the client's answers, Harry's
                                            corrections, the note and the main number (for the
                                            month by month chart)
   PUT  /admin/results/:clientId/:campaignId { values, note }  fill or correct; the client's own
                                            answers are kept apart and never overwritten

   The business type (restaurant, salon, other) is on the client (clients.niche) and is set in
   the panel's Monthly plan box. The questions are in assets/growth-resultfields.js. */
import { composeResultsNotice, sendMail } from "./mail.js";
import { json, nowIso, readJson } from "./util.js";
import { addMonths, stockholmDate } from "./rhythm-core.js";
import { cleanResults, effective, fieldsFor, mainField, niche, POST_CHANNELS } from "../../../assets/growth-resultfields.js";

const M = {
  badRequest: { sv: "Ogiltig förfrågan.", en: "Bad request." },
  notFound: { sv: "Hittades inte.", en: "Not found." },
  notYet: { sv: "Kampanjen är inte levererad än.", en: "The campaign has not been delivered yet." },
  invalid: { sv: "Kontrollera siffrorna: bara hela tal från 0.", en: "Check the numbers: whole numbers from 0 only." }
};

/* The portal asks from the 25th of the campaign month until the end of the second month after. */
export function askWindow(month, todayIso) {
  return todayIso >= month + "-25" && todayIso < addMonths(month, 3) + "-01";
}

function todayIso(url, cfg) {
  const t = url && url.searchParams.get("today");
  if (cfg.environment === "development" && t && /^\d{4}-\d{2}-\d{2}$/.test(t)) return t;
  return stockholmDate(Date.now()).iso;
}

const parse = (s) => { try { return s ? JSON.parse(s) : null; } catch (e) { return null; } };

async function rows(env, clientId) {
  return (await env.DB.prepare(
    "SELECT c.campaign_id, c.month, c.status, json_extract(c.data, '$.name') AS name, json_extract(c.data, '$.channels') AS channels, " +
      "r.client_data, r.client_at, r.skipped, r.harry_data, r.note, r.harry_at " +
      "FROM campaigns c LEFT JOIN results r ON r.client_id = c.client_id AND r.campaign_id = c.campaign_id " +
      "WHERE c.client_id = ? ORDER BY c.month DESC, c.created_at DESC"
  ).bind(clientId).all()).results || [];
}

async function clientNiche(env, clientId) {
  const c = await env.DB.prepare("SELECT id, name, niche FROM clients WHERE id = ?").bind(clientId).first();
  return c ? Object.assign(c, { niche: niche(c.niche) }) : null;
}

/* ---------- client ---------- */

export async function portalResults(env, cfg, auth, url) {
  const c = await clientNiche(env, auth.clientId);
  const today = todayIso(url, cfg);
  const items = (await rows(env, auth.clientId)).filter((r) => r.status === "delivered").map((r) => {
    const mine = parse(r.client_data);
    return {
      campaignId: r.campaign_id,
      name: r.name || "",
      month: r.month,
      channels: (parse(r.channels) || []).filter((x) => POST_CHANNELS.includes(x)),
      values: mine || {},
      answered: !!r.client_at,
      answeredAt: r.client_at || null,
      skipped: !!r.skipped,
      /* Not asked again once she answered or skipped, or once Harry filled the numbers in. */
      ask: !r.client_at && !r.skipped && !r.harry_at && askWindow(r.month, today)
    };
  });
  return json({ niche: c.niche, fields: fieldsFor(c.niche).map((f) => ({ key: f.key, type: f.type, main: !!f.main })), postChannels: POST_CHANNELS, items });
}

export async function putPortalResults(request, env, cfg, ctx, auth, campaignId) {
  const cp = await env.DB.prepare("SELECT month, status, json_extract(data, '$.name') AS name FROM campaigns WHERE client_id = ? AND campaign_id = ?").bind(auth.clientId, campaignId).first();
  if (!cp) return json({ error: "not_found", message: M.notFound }, 404);
  if (cp.status !== "delivered") return json({ error: "not_delivered", message: M.notYet }, 409);
  const b = await readJson(request, 16 * 1024);
  if (!b || typeof b !== "object") return json({ error: "bad_request", message: M.badRequest }, 400);
  const c = await clientNiche(env, auth.clientId);
  const t = nowIso();
  if (b.skip === true) {
    await env.DB.prepare(
      "INSERT INTO results (client_id, campaign_id, month, skipped, updated_at) VALUES (?, ?, ?, 1, ?) ON CONFLICT(client_id, campaign_id) DO UPDATE SET skipped = 1, updated_at = excluded.updated_at"
    ).bind(auth.clientId, campaignId, cp.month, t).run();
    return json({ ok: true, skipped: true });
  }
  const { values, errors } = cleanResults(c.niche, b.values);
  if (errors.length) return json({ error: "invalid", message: M.invalid, errors }, 400);
  const first = !(await env.DB.prepare("SELECT client_at FROM results WHERE client_id = ? AND campaign_id = ? AND client_at IS NOT NULL").bind(auth.clientId, campaignId).first());
  await env.DB.prepare(
    "INSERT INTO results (client_id, campaign_id, month, client_data, client_at, skipped, updated_at) VALUES (?, ?, ?, ?, ?, 0, ?) " +
      "ON CONFLICT(client_id, campaign_id) DO UPDATE SET client_data = excluded.client_data, client_at = excluded.client_at, skipped = 0, updated_at = excluded.updated_at"
  ).bind(auth.clientId, campaignId, cp.month, JSON.stringify(values), t, t).run();
  if (first) {
    const mail = composeResultsNotice(cfg, { company: c.name, month: cp.month, link: cfg.growthPanelUrl });
    ctx.waitUntil(sendMail(cfg, env, { to: cfg.tahaEmail, ...mail }).catch((e) => console.error("results notice failed: " + e.message)));
  }
  return json({ ok: true, values });
}

/* ---------- Harry ---------- */

export function resultOut(r, n) {
  const client = parse(r.client_data) || {};
  const harry = parse(r.harry_data) || {};
  const eff = effective(client, harry);
  const main = mainField(n).key;
  return {
    campaignId: r.campaign_id,
    name: r.name || "",
    month: r.month,
    delivered: r.status === "delivered",
    client,
    clientAt: r.client_at || null,
    skipped: !!r.skipped,
    harry,
    harryAt: r.harry_at || null,
    note: r.note || "",
    values: eff,
    main: eff[main] != null ? eff[main] : null
  };
}

export async function adminResults(env, clientId) {
  const c = await clientNiche(env, clientId);
  if (!c) return json({ error: "not_found", message: M.notFound }, 404);
  const items = (await rows(env, clientId)).map((r) => resultOut(r, c.niche));
  return json({ niche: c.niche, fields: fieldsFor(c.niche), mainKey: mainField(c.niche).key, items });
}

export async function putAdminResults(request, env, clientId, campaignId) {
  const c = await clientNiche(env, clientId);
  if (!c) return json({ error: "not_found", message: M.notFound }, 404);
  const cp = await env.DB.prepare("SELECT month FROM campaigns WHERE client_id = ? AND campaign_id = ?").bind(clientId, campaignId).first();
  if (!cp) return json({ error: "not_found", message: M.notFound }, 404);
  const b = await readJson(request, 16 * 1024);
  if (!b || typeof b !== "object") return json({ error: "bad_request", message: M.badRequest }, 400);
  const { values, errors } = cleanResults(c.niche, b.values);
  if (errors.length) return json({ error: "invalid", message: M.invalid, errors }, 400);
  const note = typeof b.note === "string" ? b.note.replace(/\s*\u2014\s*/g, ", ").trim().slice(0, 1000) : "";
  const t = nowIso();
  await env.DB.prepare(
    "INSERT INTO results (client_id, campaign_id, month, harry_data, note, harry_at, skipped, updated_at) VALUES (?, ?, ?, ?, ?, ?, 0, ?) " +
      "ON CONFLICT(client_id, campaign_id) DO UPDATE SET harry_data = excluded.harry_data, note = excluded.note, harry_at = excluded.harry_at, updated_at = excluded.updated_at"
  ).bind(clientId, campaignId, cp.month, JSON.stringify(values), note || null, t, t).run();
  const row = (await rows(env, clientId)).find((r) => r.campaign_id === campaignId);
  return json({ ok: true, item: resultOut(row, c.niche) });
}

/* For {{LAST_RESULTS}} (src/rhythm.js). */
export async function reportedFor(env, clientId) {
  const c = await clientNiche(env, clientId);
  const map = {};
  ((await env.DB.prepare("SELECT campaign_id, client_data, harry_data, note FROM results WHERE client_id = ?").bind(clientId).all()).results || []).forEach((r) => {
    map[r.campaign_id] = { values: effective(parse(r.client_data), parse(r.harry_data)), note: r.note || "" };
  });
  return { niche: c ? c.niche : "other", map };
}
