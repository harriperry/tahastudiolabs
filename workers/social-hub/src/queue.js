/* Publishing engine. Rules that matter:
   - A job is claimed atomically (scheduled -> publishing) before anything is sent, so two
     workers can never send the same job.
   - The idempotency key is created with the job, before any send.
   - A job becomes "published" only in the same atomic batch that stores the publication row.
     A failure is never shown as published.
   - A job stuck in "publishing" (the Worker died mid-send) is never re-sent: it moves to
     "needs_check" for a human to look at, because the platform may already have the post.
   - Kill switch: a paused or disabled client leaves its jobs untouched in "scheduled". */
import { audit } from "./audit.js";
import { hasConsent } from "./consent.js";
import { getConnector } from "./connectors/index.js";
import { decryptToken } from "./crypto.js";
import { canPublish } from "./killswitch.js";
import { intVar, newId, nowIso, nowMs, randomToken } from "./util.js";

export async function createJob(env, { clientId, accountId, versionId, runAt, actor }) {
  if (!(await hasConsent(env, clientId))) return { error: "consent_required" };
  const acc = await env.DB.prepare(
    "SELECT id, platform, status FROM social_accounts WHERE id = ? AND client_id = ?"
  ).bind(accountId, clientId).first();
  if (!acc || acc.status !== "active") return { error: "account_unavailable" };
  const ver = await env.DB.prepare(
    "SELECT id, platform, status FROM social_versions WHERE id = ? AND client_id = ?"
  ).bind(versionId, clientId).first();
  if (!ver) return { error: "version_not_found" };
  if (ver.status !== "approved") return { error: "version_not_approved" };
  if (ver.platform !== acc.platform) return { error: "platform_mismatch" };
  const when = Number(runAt);
  if (!Number.isFinite(when) || when < nowMs() - 60000) return { error: "bad_time" };
  const id = newId("sj");
  const now = nowIso();
  await env.DB.prepare(
    "INSERT INTO social_jobs (id, client_id, account_id, version_id, platform, run_at, status, attempts, idempotency_key, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 'scheduled', 0, ?, ?, ?)"
  ).bind(id, clientId, accountId, versionId, acc.platform, when, "idem_" + randomToken(24), now, now).run();
  await audit(env, { clientId, actor, action: "job_scheduled", detail: { jobId: id, platform: acc.platform, runAt: when } });
  return { jobId: id };
}

export async function cancelJob(env, { clientId, jobId, actor }) {
  const r = await env.DB.prepare(
    "UPDATE social_jobs SET status = 'cancelled', updated_at = ? WHERE id = ? AND client_id = ? AND status = 'scheduled'"
  ).bind(nowIso(), jobId, clientId).run();
  const ok = !!(r.meta && r.meta.changes === 1);
  if (ok) await audit(env, { clientId, actor, action: "job_cancelled", detail: { jobId } });
  return ok;
}

export async function dueJobIds(env, now = nowMs(), limit = 20) {
  const r = await env.DB.prepare(
    "SELECT id FROM social_jobs WHERE status = 'scheduled' AND run_at <= ? ORDER BY run_at LIMIT ?"
  ).bind(now, limit).all();
  return (r.results || []).map((x) => x.id);
}

export async function sweepStuck(env, now = nowMs()) {
  const cutoff = now - intVar(env.SOCIAL_STUCK_MINUTES, 10) * 60000;
  const stuck = await env.DB.prepare(
    "SELECT id, client_id FROM social_jobs WHERE status = 'publishing' AND claimed_at < ?"
  ).bind(cutoff).all();
  let n = 0;
  for (const j of stuck.results || []) {
    const r = await env.DB.prepare(
      "UPDATE social_jobs SET status = 'needs_check', last_error = 'worker stopped mid send, not resent', updated_at = ? WHERE id = ? AND status = 'publishing'"
    ).bind(nowIso(), j.id).run();
    if (r.meta && r.meta.changes === 1) {
      n++;
      await audit(env, { clientId: j.client_id, actor: "system", action: "job_needs_check", detail: { jobId: j.id } });
    }
  }
  return n;
}

function safeError(e) {
  return String((e && e.message) || "error").replace(/[\r\n]+/g, " ").slice(0, 200);
}

export async function processJob(env, jobId, now = nowMs()) {
  const job = await env.DB.prepare(
    "SELECT id, client_id, account_id, version_id, platform, idempotency_key, attempts FROM social_jobs WHERE id = ?"
  ).bind(jobId).first();
  if (!job) return "missing";
  const gate = await canPublish(env, job.client_id);
  if (!gate.ok) return "held:" + gate.reason;
  /* Our own daily cap per connected account, kept below the platform limits. */
  const cap = intVar(env.SOCIAL_DAILY_CAP, 25);
  const used = await env.DB.prepare(
    "SELECT COUNT(*) AS n FROM social_publications p JOIN social_jobs j ON j.id = p.job_id WHERE j.account_id = ? AND p.published_at > ?"
  ).bind(job.account_id, new Date(now - 86400000).toISOString()).first();
  if (used && used.n >= cap) return "held:daily_cap";
  const claim = await env.DB.prepare(
    "UPDATE social_jobs SET status = 'publishing', attempts = attempts + 1, claimed_at = ?, updated_at = ? WHERE id = ? AND status = 'scheduled' AND run_at <= ?"
  ).bind(now, nowIso(), jobId, now).run();
  if (!claim.meta || claim.meta.changes !== 1) return "skipped";
  const attempts = job.attempts + 1;
  const finish = async (status, error) => {
    await env.DB.prepare("UPDATE social_jobs SET status = ?, last_error = ?, updated_at = ? WHERE id = ?")
      .bind(status, error, nowIso(), jobId).run();
    await audit(env, { clientId: job.client_id, actor: "system", action: "job_" + status, detail: { jobId, error } });
    return status;
  };
  const acc = await env.DB.prepare(
    "SELECT external_ref, token_enc, status FROM social_accounts WHERE id = ? AND client_id = ?"
  ).bind(job.account_id, job.client_id).first();
  const ver = await env.DB.prepare(
    "SELECT body, status, media_url, link_url FROM social_versions WHERE id = ? AND client_id = ?"
  ).bind(job.version_id, job.client_id).first();
  const connector = getConnector(env, job.platform);
  if (!acc || acc.status !== "active") return finish("failed", "account not active");
  if (!ver || ver.status !== "approved") return finish("failed", "version not approved");
  if (!connector) return finish("failed", "connector unavailable");
  let outcome;
  try {
    const accessToken = await decryptToken(env, acc.token_enc);
    outcome = await connector.publish({
      accessToken, body: ver.body, link: ver.link_url, mediaUrl: ver.media_url,
      idempotencyKey: job.idempotency_key, externalRef: acc.external_ref, env
    });
  } catch (e) {
    /* The platform may or may not have the post: never guess, never resend, never call it failed. */
    if (e && e.unknown === true) return finish("needs_check", safeError(e));
    if (e && e.tokenInvalid === true) {
      await env.DB.prepare("UPDATE social_accounts SET status = 'expired', updated_at = ? WHERE id = ?").bind(nowIso(), job.account_id).run();
      return finish("failed", "account needs to be reconnected");
    }
    const max = intVar(env.SOCIAL_MAX_ATTEMPTS, 3);
    if (e && e.retryable === true && attempts < max) {
      const backoff = 60000 * Math.pow(2, attempts - 1);
      await env.DB.prepare(
        "UPDATE social_jobs SET status = 'scheduled', run_at = ?, last_error = ?, updated_at = ? WHERE id = ?"
      ).bind(now + backoff, safeError(e), nowIso(), jobId).run();
      await audit(env, { clientId: job.client_id, actor: "system", action: "job_retry", detail: { jobId, attempts } });
      return "retry";
    }
    return finish("failed", safeError(e));
  }
  await env.DB.batch([
    env.DB.prepare("INSERT INTO social_publications (job_id, client_id, external_id, url, published_at) VALUES (?, ?, ?, ?, ?)")
      .bind(jobId, job.client_id, outcome.externalId, outcome.url || null, nowIso()),
    env.DB.prepare("UPDATE social_jobs SET status = 'published', last_error = NULL, updated_at = ? WHERE id = ?")
      .bind(nowIso(), jobId)
  ]);
  await audit(env, { clientId: job.client_id, actor: "system", action: "job_published", detail: { jobId } });
  return "published";
}

/* Cron tick: recover stuck jobs, then hand due jobs to the queue (or run inline if no queue). */
export async function tick(env, now = nowMs()) {
  await sweepStuck(env, now);
  const ids = await dueJobIds(env, now);
  for (const id of ids) {
    if (env.SOCIAL_QUEUE) await env.SOCIAL_QUEUE.send({ jobId: id });
    else await processJob(env, id, now);
  }
  return ids.length;
}
