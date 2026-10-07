/* V2 Part A: the client reviews and approves each campaign in the portal (spec section 3).

   Admin:
   POST /admin/campaign/:clientId/:campaignId/review   freezes the campaign as the client will
        see it (review round 1, 2, 3...), sets Waiting for your approval, emails the client a
        link with no content. A round she has not answered yet is replaced (withdrawn).
   GET  /admin/campaign/:clientId/:campaignId/review   every round with her verdicts and comments
   Client (own id only):
   GET  /portal/campaigns                               her campaigns in review or delivered
   GET  /portal/campaign/:campaignId                    the latest round, and the content once
                                                        delivered (Part B, see content.js)
   POST /portal/review/:campaignId {items:[{key, verdict, comment}], approve}
        saves her answers on the latest waiting round. approve: true is accepted only when no
        card asks for a change. Harry gets an email (company and round only) either way. */
import { clientView } from "./clientview.js";
import { composeDecisionNotice, composeReviewEmail, sendMail } from "./mail.js";
import { json, newId, nowIso, readJson } from "./util.js";
import { checkLangGate, productionDoc } from "./lang.js";

const M = {
  badRequest: { sv: "Ogiltig förfrågan.", en: "Bad request." },
  notFound: { sv: "Hittades inte.", en: "Not found." },
  closed: { sv: "Den här omgången är redan besvarad.", en: "This round has already been answered." },
  open: { sv: "Ett kort är markerat Ändra detta. Skicka dina ändringar i stället.", en: "A card is marked Change this. Send your changes instead." },
  comment: { sv: "Skriv vad som ska ändras.", en: "Write what should change." },
  left: { sv: "Kunden har lämnat.", en: "The client has left." }
};
const all = async (env, sql, ...args) => (await env.DB.prepare(sql).bind(...args).all()).results || [];

export async function linksFor(env, clientId, campaignId) {
  const page = await env.DB.prepare("SELECT id, client_slug, slug, state FROM pages WHERE client_id = ? AND campaign_id = ?").bind(clientId, campaignId).first();
  /* Links only go out for a live page: a draft or taken-down page would not answer them. */
  if (!page || page.state !== "published") return { links: [], pageUrl: "" };
  const links = await all(env, "SELECT code, output_key, offer_code FROM links WHERE page_id = ?", page.id);
  return { links, page, pageUrl: page.state === "published" ? "/go/" + page.client_slug + "/" + page.slug : "" };
}

export async function latestRound(env, clientId, campaignId) {
  return env.DB.prepare("SELECT * FROM reviews WHERE client_id = ? AND campaign_id = ? AND state != 'withdrawn' ORDER BY round DESC LIMIT 1").bind(clientId, campaignId).first();
}

function roundOut(r, items) {
  return {
    id: r.id,
    round: r.round,
    state: r.state,
    sentAt: r.sent_at,
    decidedAt: r.decided_at || null,
    view: JSON.parse(r.data),
    items: (items || []).map((i) => ({ key: i.output_key, verdict: i.verdict, comment: i.comment || "", at: i.at }))
  };
}

export async function sendForReview(env, cfg, ctx, clientId, campaignId, request) {
  const c = await env.DB.prepare("SELECT id, name, email, language, left_at FROM clients WHERE id = ?").bind(clientId).first();
  if (!c) return json({ error: "not_found", message: M.notFound }, 404);
  if (c.left_at) return json({ error: "left", message: M.left }, 409);
  const row = await env.DB.prepare("SELECT data FROM campaigns WHERE client_id = ? AND campaign_id = ?").bind(clientId, campaignId).first();
  if (!row) return json({ error: "not_found", message: M.notFound }, 404);
  const machineDoc = JSON.parse(row.data);
  /* V2 Part H: the client only sees approved, reviewed text. */
  const b = request ? (await readJson(request, 2048)) || {} : {};
  const lg = await checkLangGate(env, clientId, campaignId, machineDoc, b.langOverride);
  if (lg) return lg;
  const doc = await productionDoc(env, clientId, campaignId, machineDoc);
  const lk = await linksFor(env, clientId, campaignId);
  const view = clientView(doc, { links: lk.links, origin: cfg.siteOrigin, pageUrl: lk.pageUrl ? cfg.siteOrigin + lk.pageUrl : "" });
  const last = await env.DB.prepare("SELECT MAX(round) AS n FROM reviews WHERE client_id = ? AND campaign_id = ?").bind(clientId, campaignId).first();
  const round = (last.n || 0) + 1;
  const t = nowIso();
  const id = newId("rv", 14);
  await env.DB.batch([
    env.DB.prepare("UPDATE reviews SET state = 'withdrawn' WHERE client_id = ? AND campaign_id = ? AND state = 'waiting'").bind(clientId, campaignId),
    env.DB.prepare("INSERT INTO reviews (id, client_id, campaign_id, round, state, data, sent_at) VALUES (?, ?, ?, ?, 'waiting', ?, ?)").bind(id, clientId, campaignId, round, JSON.stringify(view), t),
    env.DB.prepare("INSERT INTO campaign_log (client_id, campaign_id, event, detail, at) VALUES (?, ?, 'review_sent', ?, ?)").bind(clientId, campaignId, "round " + round, t)
  ]);
  const link = cfg.siteOrigin + cfg.clientHome + "#campaign-" + campaignId;
  ctx.waitUntil(sendMail(cfg, env, { to: c.email, ...composeReviewEmail(cfg, { name: c.name, language: c.language, link }) }).catch((e) => console.error("review email failed: " + e.message)));
  return getReviews(env, clientId, campaignId, 201);
}

export async function getReviews(env, clientId, campaignId, status = 200) {
  const rows = await all(env, "SELECT * FROM reviews WHERE client_id = ? AND campaign_id = ? ORDER BY round DESC", clientId, campaignId);
  const items = rows.length ? await all(env, "SELECT * FROM review_items WHERE client_id = ? AND review_id IN (" + rows.map(() => "?").join(",") + ")", clientId, ...rows.map((r) => r.id)) : [];
  const log = await all(env, "SELECT event, detail, at FROM campaign_log WHERE client_id = ? AND campaign_id = ? ORDER BY id DESC LIMIT 50", clientId, campaignId);
  return json({ rounds: rows.map((r) => roundOut(r, items.filter((i) => i.review_id === r.id))), log }, status);
}

/* ---------- client ---------- */

export async function portalCampaigns(env, auth) {
  const rows = await all(env,
    "SELECT c.campaign_id, c.month, c.status, json_extract(c.data, '$.name') AS name, (SELECT state FROM reviews r WHERE r.client_id = c.client_id AND r.campaign_id = c.campaign_id AND r.state != 'withdrawn' ORDER BY round DESC LIMIT 1) AS review_state, (SELECT round FROM reviews r WHERE r.client_id = c.client_id AND r.campaign_id = c.campaign_id AND r.state != 'withdrawn' ORDER BY round DESC LIMIT 1) AS round, c.updated_at FROM campaigns c WHERE c.client_id = ? ORDER BY c.month DESC, c.updated_at DESC",
    auth.clientId);
  return json({
    campaigns: rows
      .filter((r) => r.review_state || r.status === "delivered")
      .map((r) => ({ campaignId: r.campaign_id, name: r.name || "", month: r.month, delivered: r.status === "delivered", reviewState: r.review_state || null, round: r.round || null }))
  });
}

export async function postReview(request, env, cfg, ctx, auth, campaignId) {
  const r = await latestRound(env, auth.clientId, campaignId);
  if (!r) return json({ error: "not_found", message: M.notFound }, 404);
  if (r.state !== "waiting") return json({ error: "closed", message: M.closed }, 409);
  const b = await readJson(request, 64 * 1024);
  if (!b || !Array.isArray(b.items) || b.items.length > 60) return json({ error: "bad_request", message: M.badRequest }, 400);
  const keys = new Set(JSON.parse(r.data).cards.map((c) => c.key));
  const t = nowIso();
  const stmts = [];
  for (const it of b.items) {
    if (!it || !keys.has(it.key) || !["ok", "change"].includes(it.verdict)) return json({ error: "bad_request", message: M.badRequest }, 400);
    const comment = typeof it.comment === "string" ? it.comment.replace(/\u2014/g, ", ").trim().slice(0, 1000) : "";
    if (it.verdict === "change" && !comment) return json({ error: "comment", message: M.comment, key: it.key }, 400);
    stmts.push(env.DB.prepare("INSERT INTO review_items (review_id, client_id, output_key, verdict, comment, at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(review_id, output_key) DO UPDATE SET verdict = excluded.verdict, comment = excluded.comment, at = excluded.at")
      .bind(r.id, auth.clientId, it.key, it.verdict, comment || null, t));
  }
  if (stmts.length) await env.DB.batch(stmts);
  const items = await all(env, "SELECT verdict FROM review_items WHERE review_id = ?", r.id);
  const changes = items.filter((i) => i.verdict === "change").length;
  let state = "waiting";
  if (b.approve) {
    if (changes) return json({ error: "open", message: M.open }, 409);
    state = "approved";
  } else if (b.send && changes) state = "changes";
  if (state !== "waiting") {
    await env.DB.batch([
      env.DB.prepare("UPDATE reviews SET state = ?, decided_at = ? WHERE id = ?").bind(state, t, r.id),
      env.DB.prepare("INSERT INTO campaign_log (client_id, campaign_id, event, detail, at) VALUES (?, ?, ?, ?, ?)").bind(auth.clientId, campaignId, state === "approved" ? "approved" : "changes_requested", "round " + r.round + (changes ? ", " + changes + " to change" : ""), t)
    ]);
    const c = await env.DB.prepare("SELECT name FROM clients WHERE id = ?").bind(auth.clientId).first();
    const mail = composeDecisionNotice(cfg, { company: (c && c.name) || "A client", round: r.round, approved: state === "approved", link: cfg.growthPanelUrl });
    ctx.waitUntil(sendMail(cfg, env, { to: cfg.tahaEmail, ...mail }).catch((e) => console.error("decision notice failed: " + e.message)));
  }
  return json({ ok: true, state, round: r.round, changes });
}
