/* Phase 5: campaigns.
   ScriptForge's Campaign Generator writes the campaign in Harry's browser from the saved
   Business Brain, lets him edit it, then saves it here. The Vault never sees the AI key or
   the prompt; it checks the document against campaign.schema.json and stores it.

   POST /admin/campaign/:clientId                         {campaign}  save or update; status Campaign in production
   PATCH /admin/campaign/:clientId/:campaignId/status {status}        delivered or back in production
   PATCH /admin/status/:clientId {status}                             manual status change
   GET  /admin/campaigns/:clientId                                    list of the client's campaigns
   GET  /admin/campaign/:clientId/:campaignId                         one campaign
   From V2 phase G1 a campaign may carry a visuals array (campaign-2). */
import { STATUS_LABELS } from "./config.js";
import { SCHEMAS } from "./schemas.js";
import { validate } from "./validate.js";
import { json, nowIso, readJson } from "./util.js";
import { looksLikeKey } from "./brain.js";
import { composeDeliveredEmail, sendMail } from "./mail.js";

const M = {
  badRequest: { sv: "Ogiltig förfrågan.", en: "Bad request." },
  notApproved: { sv: "Kunden har inte godkänt kampanjen. Ange ett skäl för att leverera ändå.", en: "The client has not approved the campaign. Give a reason to deliver anyway." },
  notFound: { sv: "Hittades inte.", en: "Not found." },
  invalid: { sv: "Kampanjen följer inte schemat.", en: "The campaign does not match the schema." },
  brain: { sv: "Den hjärnversionen finns inte.", en: "That brain version does not exist." },
  key: {
    sv: "Texten ser ut att innehålla en API-nyckel. Den sparas inte i valvet.",
    en: "The text looks like it contains an API key. The Vault never stores keys."
  }
};

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

function summary(r) {
  const d = JSON.parse(r.data);
  return {
    campaignId: r.campaign_id,
    name: d.name,
    month: r.month,
    goal: d.goal,
    language: d.language,
    brainVersion: r.brain_version,
    status: r.status,
    createdAt: r.created_at,
    updatedAt: r.updated_at
  };
}

async function setClientStatus(env, clientId, status, t) {
  const c = await env.DB.prepare("SELECT status FROM clients WHERE id = ?").bind(clientId).first();
  const stmts = [env.DB.prepare("UPDATE clients SET status = ?, updated_at = ? WHERE id = ?").bind(status, t, clientId)];
  if (!c || c.status !== status) {
    stmts.push(env.DB.prepare("INSERT INTO status_history (client_id, status, changed_at, changed_by) VALUES (?, ?, ?, 'admin')").bind(clientId, status, t));
  }
  return stmts;
}

export async function saveCampaign(request, env, clientId) {
  const client = await env.DB.prepare("SELECT id FROM clients WHERE id = ?").bind(clientId).first();
  if (!client) return json({ error: "not_found", message: M.notFound }, 404);
  const b = await readJson(request, 512 * 1024);
  if (!b || !b.campaign || typeof b.campaign !== "object" || Array.isArray(b.campaign)) return json({ error: "bad_request", message: M.badRequest }, 400);
  if (looksLikeKey(JSON.stringify(b.campaign))) return json({ error: "api_key", message: M.key }, 400);

  const bv = b.campaign.brainVersion;
  const brain = Number.isInteger(bv) ? await env.DB.prepare("SELECT version FROM brains WHERE client_id = ? AND version = ?").bind(clientId, bv).first() : null;
  if (!brain) return json({ error: "brain", message: M.brain }, 400);

  /* Saving always puts the campaign (and the client) in production. Mark delivered is its own step.
     V2 phase G1: a campaign with a Visual Pack is a campaign-2 document; one without stays
     campaign-1, so V1 campaigns keep their version when they are saved again. */
  const hasVisuals = Array.isArray(b.campaign.visuals) && b.campaign.visuals.length > 0;
  const schemaVersion = hasVisuals ? "campaign-2" : b.campaign.schemaVersion === "campaign-2" ? "campaign-2" : "campaign-1";
  const doc = stripDashes(Object.assign({}, b.campaign, { schemaVersion, clientId, status: "in_production" }));
  const v = validate(SCHEMAS.campaign, doc);
  if (!v.valid) return json({ error: "invalid", message: M.invalid, details: v.errors }, 400);

  const t = nowIso();
  const existing = await env.DB.prepare("SELECT created_at FROM campaigns WHERE client_id = ? AND campaign_id = ?").bind(clientId, doc.campaignId).first();
  const stmts = [
    existing
      ? env.DB.prepare("UPDATE campaigns SET brain_version = ?, month = ?, status = 'in_production', data = ?, updated_at = ? WHERE client_id = ? AND campaign_id = ?")
          .bind(bv, doc.month, JSON.stringify(doc), t, clientId, doc.campaignId)
      : env.DB.prepare("INSERT INTO campaigns (client_id, campaign_id, brain_version, month, status, data, created_at, updated_at) VALUES (?, ?, ?, ?, 'in_production', ?, ?, ?)")
          .bind(clientId, doc.campaignId, bv, doc.month, JSON.stringify(doc), t, t)
  ].concat(await setClientStatus(env, clientId, "campaign_in_production", t));
  await env.DB.batch(stmts);
  return json({ ok: true, created: !existing, campaign: doc, clientStatus: "campaign_in_production", statusLabel: STATUS_LABELS.campaign_in_production, savedAt: t }, existing ? 200 : 201);
}

/* PATCH /admin/campaign/:clientId/:campaignId/status {status: "delivered" | "in_production"}
   Mark delivered sets the client to Campaign delivered; moving back sets Campaign in production. */
export async function setCampaignStatus(request, env, clientId, campaignId, cfg, ctx) {
  const b = await readJson(request, 2048);
  const status = b && (b.status === "delivered" || b.status === "in_production") ? b.status : null;
  if (!status) return json({ error: "bad_request", message: M.badRequest }, 400);
  const r = await env.DB.prepare("SELECT data, status FROM campaigns WHERE client_id = ? AND campaign_id = ?").bind(clientId, campaignId).first();
  if (!r) return json({ error: "not_found", message: M.notFound }, 404);
  /* V2 Part A: Mark delivered needs the client's approval of the latest review round, or a
     reason from Harry, which is logged. */
  const logs = [];
  if (status === "delivered" && r.status !== "delivered") {
    const rv = await env.DB.prepare("SELECT state, round FROM reviews WHERE client_id = ? AND campaign_id = ? AND state != 'withdrawn' ORDER BY round DESC LIMIT 1").bind(clientId, campaignId).first();
    const reason = typeof b.override === "string" ? b.override.replace(/\u2014/g, ", ").trim().slice(0, 500) : "";
    if (!rv || rv.state !== "approved") {
      if (reason.length < 5) return json({ error: "not_approved", message: M.notApproved, reviewState: rv ? rv.state : null }, 409);
      logs.push(env.DB.prepare("INSERT INTO campaign_log (client_id, campaign_id, event, detail, at) VALUES (?, ?, 'delivered_without_approval', ?, ?)").bind(clientId, campaignId, reason, nowIso()));
    }
    logs.push(env.DB.prepare("INSERT INTO campaign_log (client_id, campaign_id, event, detail, at) VALUES (?, ?, 'delivered', NULL, ?)").bind(clientId, campaignId, nowIso()));
  }
  const doc = Object.assign(JSON.parse(r.data), { status });
  const clientStatus = status === "delivered" ? "campaign_delivered" : "campaign_in_production";
  const t = nowIso();
  await env.DB.batch(
    [env.DB.prepare("UPDATE campaigns SET status = ?, data = ?, updated_at = ? WHERE client_id = ? AND campaign_id = ?").bind(status, JSON.stringify(doc), t, clientId, campaignId)]
      .concat(await setClientStatus(env, clientId, clientStatus, t))
      .concat(logs)
  );
  /* V2 Part B: the client hears that her content is in the portal (no content in the email). */
  if (status === "delivered" && r.status !== "delivered" && cfg && ctx && b.notify !== false) {
    const c = await env.DB.prepare("SELECT name, email, language, left_at FROM clients WHERE id = ?").bind(clientId).first();
    if (c && !c.left_at) {
      const mail = composeDeliveredEmail(cfg, { name: c.name, language: c.language, link: cfg.siteOrigin + cfg.clientHome + "#content-" + campaignId });
      ctx.waitUntil(sendMail(cfg, env, { to: c.email, ...mail }).catch((e) => console.error("delivered email failed: " + e.message)));
    }
  }
  return json({ ok: true, campaign: doc, clientStatus, statusLabel: STATUS_LABELS[clientStatus] });
}

/* PATCH /admin/status/:clientId {status}: Harry sets the client's status by hand (spec section 4). */
export async function setManualStatus(request, env, clientId) {
  const b = await readJson(request, 1024);
  const status = b && typeof b.status === "string" && STATUS_LABELS[b.status] ? b.status : null;
  if (!status) return json({ error: "bad_request", message: M.badRequest }, 400);
  const c = await env.DB.prepare("SELECT id FROM clients WHERE id = ?").bind(clientId).first();
  if (!c) return json({ error: "not_found", message: M.notFound }, 404);
  const t = nowIso();
  await env.DB.batch(await setClientStatus(env, clientId, status, t));
  return json({ ok: true, clientStatus: status, statusLabel: STATUS_LABELS[status] });
}

export async function listCampaigns(env, clientId) {
  const client = await env.DB.prepare("SELECT id FROM clients WHERE id = ?").bind(clientId).first();
  if (!client) return json({ error: "not_found", message: M.notFound }, 404);
  const rows = await env.DB.prepare("SELECT campaign_id, brain_version, month, status, data, created_at, updated_at FROM campaigns WHERE client_id = ? ORDER BY updated_at DESC").bind(clientId).all();
  return json({ campaigns: (rows.results || []).map(summary) });
}

export async function getCampaign(env, clientId, campaignId) {
  const r = await env.DB.prepare("SELECT data FROM campaigns WHERE client_id = ? AND campaign_id = ?").bind(clientId, campaignId).first();
  if (!r) return json({ error: "not_found", message: M.notFound }, 404);
  return json({ campaign: JSON.parse(r.data) });
}
