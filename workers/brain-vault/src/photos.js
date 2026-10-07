/* V2 phase G2a: photo requests from the Visual Pack to the client portal.

   Admin (index.js checks the admin role first):
   POST   /admin/photo-requests/:clientId/:campaignId {requests:[{visualId, text:{sv,en}}]}
          sends one request per brief marked Photo needed from client (source client_photo,
          photo_ref null). A brief that already has an open request gets its text updated
          instead of a second request. The client gets one email, in both languages, with no
          campaign content: only that there are photos to send and a link to the portal.
   GET    /admin/photo-requests/:clientId/:campaignId   the campaign's requests
   DELETE /admin/photo-requests/:clientId/:campaignId/:requestId   cancels an open request
   Client (own id only):
   GET    /portal/photo-requests                        open and received requests
   POST   /uploads?section=pictures&request=pr_...      answers a request (portal.js calls
          receivePhoto() after the picture is stored): the request is marked received and the
          picture becomes the brief's photo_ref in the saved campaign. Harry gets an email with
          the company name only. */
import { composePhotoNotice, composePhotoRequestEmail, sendMail } from "./mail.js";
import { looksLikeKey } from "./brain.js";
import { SCHEMAS } from "./schemas.js";
import { validate } from "./validate.js";
import { json, newId, nowIso, readJson } from "./util.js";

const M = {
  badRequest: { sv: "Ogiltig förfrågan.", en: "Bad request." },
  notFound: { sv: "Hittades inte.", en: "Not found." },
  none: { sv: "Det finns inga bildbriefer som behöver ett foto från kunden.", en: "No brief in this campaign needs a photo from the client." },
  notNeeded: { sv: "Den briefen behöver inget foto från kunden.", en: "That brief does not need a photo from the client." },
  key: { sv: "Texten ser ut att innehålla en API-nyckel.", en: "The text looks like it contains an API key." },
  closed: { sv: "Den förfrågan är redan besvarad eller borttagen.", en: "That request has already been answered or cancelled." }
};

const all = async (env, sql, ...args) => (await env.DB.prepare(sql).bind(...args).all()).results || [];
const clean = (v, max) => (typeof v === "string" ? v.replace(/\s*\u2014\s*/g, ", ").trim().slice(0, max) : "");

export function requestOut(r) {
  return {
    id: r.id,
    campaignId: r.campaign_id,
    visualId: r.visual_id,
    placement: r.placement || "",
    text: { sv: r.text_sv || "", en: r.text_en || "" },
    state: r.state,
    fileId: r.file_id || null,
    createdAt: r.created_at,
    receivedAt: r.received_at || null
  };
}

async function campaignDoc(env, clientId, campaignId) {
  const r = await env.DB.prepare("SELECT data FROM campaigns WHERE client_id = ? AND campaign_id = ?").bind(clientId, campaignId).first();
  return r ? JSON.parse(r.data) : null;
}

const needsPhoto = (v) => v && v.source === "client_photo" && !v.photo_ref;

export async function sendPhotoRequests(request, env, cfg, ctx, clientId, campaignId) {
  const client = await env.DB.prepare("SELECT id, name, email, language, left_at FROM clients WHERE id = ?").bind(clientId).first();
  if (!client) return json({ error: "not_found", message: M.notFound }, 404);
  const doc = await campaignDoc(env, clientId, campaignId);
  if (!doc) return json({ error: "not_found", message: M.notFound }, 404);
  const b = await readJson(request, 64 * 1024);
  if (!b || !Array.isArray(b.requests) || !b.requests.length || b.requests.length > 40) return json({ error: "bad_request", message: M.badRequest }, 400);
  if (looksLikeKey(JSON.stringify(b.requests))) return json({ error: "api_key", message: M.key }, 400);
  const byId = {};
  (doc.visuals || []).forEach((v) => { byId[v.id] = v; });
  const wanted = [];
  for (const x of b.requests) {
    const v = x && byId[x.visualId];
    if (!v) return json({ error: "bad_request", message: M.badRequest }, 400);
    if (!needsPhoto(v)) return json({ error: "not_needed", message: M.notNeeded, visualId: x.visualId }, 400);
    const en = clean(x.text && x.text.en, 1500) || clean(v.prompt, 1500);
    const sv = clean(x.text && x.text.sv, 1500);
    if (!en) return json({ error: "bad_request", message: M.badRequest }, 400);
    wanted.push({ v, en, sv });
  }
  if (!wanted.length) return json({ error: "none", message: M.none }, 400);
  const t = nowIso();
  const open = await all(env, "SELECT id, visual_id FROM photo_requests WHERE client_id = ? AND campaign_id = ? AND state = 'open'", clientId, campaignId);
  const openBy = {};
  open.forEach((r) => { openBy[r.visual_id] = r.id; });
  const stmts = [];
  let created = 0;
  for (const w of wanted) {
    if (openBy[w.v.id]) {
      stmts.push(env.DB.prepare("UPDATE photo_requests SET text_sv = ?, text_en = ?, placement = ? WHERE id = ?").bind(w.sv, w.en, w.v.placement || "", openBy[w.v.id]));
    } else {
      created++;
      stmts.push(env.DB.prepare("INSERT INTO photo_requests (id, client_id, campaign_id, visual_id, placement, text_sv, text_en, state, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'open', ?)")
        .bind(newId("pr", 14), clientId, campaignId, w.v.id, w.v.placement || "", w.sv, w.en, t));
    }
  }
  await env.DB.batch(stmts);
  let emailed = false;
  if (created && !client.left_at) {
    const mail = composePhotoRequestEmail(cfg, { name: client.name, language: client.language, count: wanted.length, link: cfg.siteOrigin + cfg.clientHome + "#photos" });
    ctx.waitUntil(sendMail(cfg, env, { to: client.email, ...mail }).catch((e) => console.error("photo request email failed: " + e.message)));
    emailed = true;
  }
  const rows = await all(env, "SELECT * FROM photo_requests WHERE client_id = ? AND campaign_id = ? ORDER BY created_at ASC", clientId, campaignId);
  return json({ ok: true, created, updated: wanted.length - created, emailed, requests: rows.map(requestOut) }, created ? 201 : 200);
}

export async function listPhotoRequestsAdmin(env, clientId, campaignId) {
  const c = await env.DB.prepare("SELECT id FROM clients WHERE id = ?").bind(clientId).first();
  if (!c) return json({ error: "not_found", message: M.notFound }, 404);
  const rows = await all(env, "SELECT * FROM photo_requests WHERE client_id = ? AND campaign_id = ? ORDER BY created_at ASC", clientId, campaignId);
  return json({ requests: rows.map(requestOut) });
}

export async function cancelPhotoRequest(env, clientId, campaignId, requestId) {
  const r = await env.DB.prepare("SELECT state FROM photo_requests WHERE id = ? AND client_id = ? AND campaign_id = ?").bind(requestId, clientId, campaignId).first();
  if (!r) return json({ error: "not_found", message: M.notFound }, 404);
  if (r.state !== "open") return json({ error: "closed", message: M.closed }, 409);
  await env.DB.prepare("UPDATE photo_requests SET state = 'cancelled' WHERE id = ?").bind(requestId).run();
  return json({ ok: true });
}

/* The client's own requests, newest campaign first, with the campaign name for context. */
export async function listPhotoRequestsPortal(env, auth) {
  const rows = await all(env,
    "SELECT r.*, c.data AS cdata FROM photo_requests r LEFT JOIN campaigns c ON c.client_id = r.client_id AND c.campaign_id = r.campaign_id WHERE r.client_id = ? AND r.state IN ('open','received') ORDER BY r.created_at DESC",
    auth.clientId);
  return json({
    requests: rows.map((r) => {
      let name = "";
      try { name = JSON.parse(r.cdata).name || ""; } catch (e) {}
      return Object.assign(requestOut(r), { campaignName: name });
    })
  });
}

/* Is this an open request of this client? Used by the upload before it stores anything. */
export async function openRequest(env, clientId, requestId) {
  if (!/^pr_[a-z0-9]{4,32}$/.test(String(requestId || ""))) return null;
  return env.DB.prepare("SELECT * FROM photo_requests WHERE id = ? AND client_id = ? AND state = 'open'").bind(requestId, clientId).first();
}

/* After the picture is stored: mark the request received and make the picture the brief's
   photo in the saved campaign (the brief then shows Client photo in the panel). */
export async function receivePhoto(env, cfg, ctx, clientId, req, fileId) {
  const t = nowIso();
  const stmts = [env.DB.prepare("UPDATE photo_requests SET state = 'received', file_id = ?, received_at = ? WHERE id = ? AND state = 'open'").bind(fileId, t, req.id)];
  const row = await env.DB.prepare("SELECT data FROM campaigns WHERE client_id = ? AND campaign_id = ?").bind(clientId, req.campaign_id).first();
  let briefUpdated = false;
  if (row) {
    const doc = JSON.parse(row.data);
    const v = (doc.visuals || []).find((x) => x.id === req.visual_id);
    if (v && needsPhoto(v)) {
      v.photo_ref = fileId;
      if (validate(SCHEMAS.campaign, doc).valid) {
        stmts.push(env.DB.prepare("UPDATE campaigns SET data = ?, updated_at = ? WHERE client_id = ? AND campaign_id = ?").bind(JSON.stringify(doc), t, clientId, req.campaign_id));
        briefUpdated = true;
      }
    }
  }
  await env.DB.batch(stmts);
  const c = await env.DB.prepare("SELECT name FROM clients WHERE id = ?").bind(clientId).first();
  const left = await env.DB.prepare("SELECT COUNT(*) AS n FROM photo_requests WHERE client_id = ? AND state = 'open'").bind(clientId).first();
  const mail = composePhotoNotice(cfg, { company: (c && c.name) || "A client", open: left.n, link: cfg.growthPanelUrl });
  ctx.waitUntil(sendMail(cfg, env, { to: cfg.tahaEmail, ...mail }).catch((e) => console.error("photo notice failed: " + e.message)));
  return { briefUpdated, stillOpen: left.n };
}

/* The client deleted a picture that answered a request: the request opens again and the
   brief goes back to Photo needed from client, so nothing points at a missing file. */
export async function fileRemoved(env, clientId, fileId) {
  const reqs = await all(env, "SELECT * FROM photo_requests WHERE client_id = ? AND file_id = ?", clientId, fileId);
  for (const r of reqs) {
    const stmts = [env.DB.prepare("UPDATE photo_requests SET state = 'open', file_id = NULL, received_at = NULL WHERE id = ?").bind(r.id)];
    const row = await env.DB.prepare("SELECT data FROM campaigns WHERE client_id = ? AND campaign_id = ?").bind(clientId, r.campaign_id).first();
    if (row) {
      const doc = JSON.parse(row.data);
      const v = (doc.visuals || []).find((x) => x.id === r.visual_id);
      if (v && v.photo_ref === fileId) {
        v.photo_ref = null;
        stmts.push(env.DB.prepare("UPDATE campaigns SET data = ?, updated_at = ? WHERE client_id = ? AND campaign_id = ?").bind(JSON.stringify(doc), nowIso(), clientId, r.campaign_id));
      }
    }
    await env.DB.batch(stmts);
  }
}
