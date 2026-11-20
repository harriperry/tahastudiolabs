/* Growth Department proposals: drafts the team prepares for a client, which the client reviews
   in their panel. Rules that matter:
   - Only an admin proposes, and only the client decides. An admin can never approve or schedule.
   - A proposal is not a post. Nothing is published until the client approves it AND the normal
     engine rules hold (consent, enabled client, no pause, daily cap).
   - Approving creates an approved version plus a scheduled job through the existing createJob,
     so this phase adds no second way to publish.
   - A proposal is claimed atomically (pending -> approved), so a double click or two tabs can
     never create two jobs.
   - Emails and the audit log never contain post text. A failed email never blocks the work.
   - An unanswered proposal expires. It never publishes by itself. */
import { audit } from "./audit.js";
import { hasConsent } from "./consent.js";
import { composeDecisionNotice, composeProposalNotice, sendMail } from "./mail.js";
import { createJob } from "./queue.js";
import { adminEmails } from "./auth.js";
import { httpsUrl, intVar, newId, nowIso, nowMs } from "./util.js";

const MAX_BATCH = 20;
const MAX_TEXT = 5000;
const MAX_NOTE = 1000;

function platforms(env) {
  const p = ["facebook", "instagram"];
  if (env.ENVIRONMENT !== "production" || env.SOCIAL_ALLOW_MOCK === "on") p.push("mock");
  return p;
}

function panelLink(env) {
  return (env.SITE_ORIGIN || "https://tahastudiolabs.com") + "/api/vault/social/panel";
}

function teamAddress(env) {
  return env.NOTIFY_EMAIL || adminEmails(env)[0] || null;
}

/* Validates the whole batch first; nothing is stored unless every item is valid. */
export async function createProposals(env, { clientId, items, actor }) {
  if (!Array.isArray(items) || items.length < 1 || items.length > MAX_BATCH) return { error: "bad_request" };
  const client = await env.DB.prepare(
    "SELECT id, name, email, language FROM clients WHERE id = ? AND left_at IS NULL"
  ).bind(clientId).first();
  if (!client) return { error: "not_found" };

  const maxPending = intVar(env.SOCIAL_MAX_PENDING, 20);
  const open = await env.DB.prepare(
    "SELECT COUNT(*) AS n FROM social_proposals WHERE client_id = ? AND status = 'pending' AND expires_at > ?"
  ).bind(clientId, nowMs()).first();
  if ((open ? open.n : 0) + items.length > maxPending) return { error: "too_many" };

  const allowed = platforms(env);
  const clean = [];
  for (let i = 0; i < items.length; i++) {
    const it = items[i] && typeof items[i] === "object" ? items[i] : {};
    const text = typeof it.body === "string" ? it.body.trim() : "";
    const platform = String(it.platform || "");
    if (!text || text.length > MAX_TEXT || !allowed.includes(platform)) return { error: "bad_request", index: i };
    const linkUrl = httpsUrl(it.linkUrl);
    const mediaUrl = httpsUrl(it.mediaUrl);
    if (linkUrl === false || mediaUrl === false) return { error: "bad_url", index: i };
    if (platform === "instagram" && !mediaUrl) return { error: "media_required", index: i };
    let accountId = null;
    if (it.accountId) {
      const acc = await env.DB.prepare("SELECT id, platform, status FROM social_accounts WHERE id = ? AND client_id = ?")
        .bind(String(it.accountId), clientId).first();
      if (!acc || acc.status !== "active" || acc.platform !== platform) return { error: "account_unavailable", index: i };
      accountId = acc.id;
    }
    let runAt = null;
    if (it.suggestedRunAt !== undefined && it.suggestedRunAt !== null && it.suggestedRunAt !== "") {
      runAt = Number(it.suggestedRunAt);
      if (!Number.isFinite(runAt) || runAt < nowMs() - 60000) return { error: "bad_time", index: i };
    }
    clean.push({ text, platform, linkUrl, mediaUrl, accountId, runAt });
  }

  const batchId = newId("pb");
  const now = nowIso();
  const expires = nowMs() + intVar(env.SOCIAL_PROPOSAL_DAYS, 14) * 86400000;
  const ids = [];
  const stmts = clean.map((c) => {
    const id = newId("sp");
    ids.push(id);
    return env.DB.prepare(
      "INSERT INTO social_proposals (id, client_id, batch_id, platform, body, media_url, link_url, account_id, suggested_run_at, status, proposed_by, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?)"
    ).bind(id, clientId, batchId, c.platform, c.text, c.mediaUrl, c.linkUrl, c.accountId, c.runAt, actor, now, expires);
  });
  await env.DB.batch(stmts);
  await audit(env, { clientId, actor, action: "proposals_created", detail: { batchId, count: ids.length } });

  let notified = false;
  try {
    const mail = composeProposalNotice({ name: client.name, language: client.language, count: ids.length, link: panelLink(env) });
    const r = await sendMail(env, { to: client.email, ...mail });
    notified = r.sent;
    await audit(env, { clientId, actor: "system", action: r.sent ? "proposals_notified" : "proposals_notify_skipped", detail: { batchId, reason: r.reason || null } });
  } catch (e) {}
  return { batchId, ids, notified };
}

export async function listProposals(env, clientId) {
  const rows = await env.DB.prepare(
    "SELECT id, batch_id, platform, body, media_url, link_url, account_id, suggested_run_at, status, created_at, expires_at, decision_note, edited FROM social_proposals WHERE client_id = ? ORDER BY created_at DESC, id LIMIT 50"
  ).bind(clientId).all();
  const t = nowMs();
  return (rows.results || []).map((r) => (r.status === "pending" && r.expires_at <= t ? { ...r, status: "expired" } : r));
}

async function notifyTeam(env, clientId, decision) {
  try {
    const to = teamAddress(env);
    if (!to) return;
    const c = await env.DB.prepare("SELECT name FROM clients WHERE id = ?").bind(clientId).first();
    const mail = composeDecisionNotice({ company: c ? c.name : "Client", decision, link: panelLink(env) });
    await sendMail(env, { to, ...mail });
  } catch (e) {}
}

/* The client decides. action: approve | changes | reject. */
export async function decideProposal(env, { clientId, proposalId, action, note, body, accountId, runAt, actor }) {
  const p = await env.DB.prepare("SELECT * FROM social_proposals WHERE id = ? AND client_id = ?").bind(proposalId, clientId).first();
  if (!p) return { error: "not_found" };
  if (p.status !== "pending") return { error: "not_pending" };
  if (p.expires_at <= nowMs()) {
    await env.DB.prepare("UPDATE social_proposals SET status = 'expired' WHERE id = ? AND status = 'pending'").bind(p.id).run();
    return { error: "expired" };
  }
  const cleanNote = typeof note === "string" ? note.trim().slice(0, MAX_NOTE) : "";

  if (action === "changes" || action === "reject") {
    if (action === "changes" && !cleanNote) return { error: "note_required" };
    const status = action === "changes" ? "changes_requested" : "rejected";
    const r = await env.DB.prepare(
      "UPDATE social_proposals SET status = ?, decided_at = ?, decided_by = ?, decision_note = ? WHERE id = ? AND client_id = ? AND status = 'pending'"
    ).bind(status, nowIso(), actor, cleanNote || null, p.id, clientId).run();
    if (!(r.meta && r.meta.changes === 1)) return { error: "not_pending" };
    await audit(env, { clientId, actor, action: "proposal_" + status, detail: { proposalId: p.id } });
    await notifyTeam(env, clientId, status);
    return { ok: true, status };
  }
  if (action !== "approve") return { error: "bad_request" };

  /* Validate everything before claiming, so a refusal leaves the proposal pending. */
  if (!(await hasConsent(env, clientId))) return { error: "consent_required" };
  let text = p.body;
  let edited = 0;
  if (typeof body === "string" && body.trim() !== p.body) {
    text = body.trim();
    if (!text || text.length > MAX_TEXT) return { error: "bad_request" };
    edited = 1;
  }
  const accId = String(accountId || p.account_id || "");
  const acc = await env.DB.prepare("SELECT id, platform, status FROM social_accounts WHERE id = ? AND client_id = ?").bind(accId, clientId).first();
  if (!acc || acc.status !== "active") return { error: "account_unavailable" };
  if (acc.platform !== p.platform) return { error: "platform_mismatch" };
  const when = Number(runAt !== undefined && runAt !== null && runAt !== "" ? runAt : p.suggested_run_at);
  if (!Number.isFinite(when) || when < nowMs() - 60000) return { error: "bad_time" };

  const claim = await env.DB.prepare(
    "UPDATE social_proposals SET status = 'approved', decided_at = ?, decided_by = ?, edited = ? WHERE id = ? AND client_id = ? AND status = 'pending' AND expires_at > ?"
  ).bind(nowIso(), actor, edited, p.id, clientId, nowMs()).run();
  if (!(claim.meta && claim.meta.changes === 1)) return { error: "not_pending" };

  const versionId = newId("sv");
  const now = nowIso();
  await env.DB.prepare(
    "INSERT INTO social_versions (id, client_id, platform, body, status, created_by, created_at, approved_at, approved_by, media_url, link_url) VALUES (?, ?, ?, ?, 'approved', ?, ?, ?, ?, ?, ?)"
  ).bind(versionId, clientId, p.platform, text, p.proposed_by, now, now, actor, p.media_url, p.link_url).run();
  const job = await createJob(env, { clientId, accountId: acc.id, versionId, runAt: when, actor });
  if (job.error) {
    /* Undo, so the client can try again. */
    await env.DB.prepare("UPDATE social_versions SET status = 'withdrawn' WHERE id = ?").bind(versionId).run();
    await env.DB.prepare("UPDATE social_proposals SET status = 'pending', decided_at = NULL, decided_by = NULL, edited = 0 WHERE id = ?").bind(p.id).run();
    return { error: job.error };
  }
  await env.DB.prepare("UPDATE social_proposals SET version_id = ?, job_id = ? WHERE id = ?").bind(versionId, job.jobId, p.id).run();
  await audit(env, { clientId, actor, action: "proposal_approved", detail: { proposalId: p.id, versionId, jobId: job.jobId, edited: !!edited } });
  await notifyTeam(env, clientId, "approved");
  return { ok: true, status: "approved", versionId, jobId: job.jobId };
}

export async function withdrawProposal(env, { clientId, proposalId, actor }) {
  const r = await env.DB.prepare(
    "UPDATE social_proposals SET status = 'withdrawn', decided_at = ?, decided_by = ? WHERE id = ? AND client_id = ? AND status = 'pending'"
  ).bind(nowIso(), actor, proposalId, clientId).run();
  const ok = !!(r.meta && r.meta.changes === 1);
  if (ok) await audit(env, { clientId, actor, action: "proposal_withdrawn", detail: { proposalId } });
  return ok;
}

/* Run from the cron. An unanswered proposal expires and is never published. */
export async function expireProposals(env) {
  const r = await env.DB.prepare("UPDATE social_proposals SET status = 'expired' WHERE status = 'pending' AND expires_at <= ?").bind(nowMs()).run();
  const n = r.meta ? r.meta.changes : 0;
  if (n > 0) await audit(env, { actor: "system", action: "proposals_expired", detail: { count: n } });
  return n;
}
