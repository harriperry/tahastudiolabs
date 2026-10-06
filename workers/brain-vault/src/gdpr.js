/* Phase 6: GDPR tools.

   GET    /admin/export/:clientId              the client's full record as one JSON document
   POST   /admin/clients/:clientId/left        {left:true|false} the client has left (or is back);
                                               everything is erased RETENTION_MONTHS (6) later
   DELETE /admin/clients/:clientId             {confirm:"<client email>"} erase everything now

   Erasure removes every R2 file under the client's folder and every D1 row that belongs to the
   client: the client record, consents, intake drafts and versions, file records, brains,
   campaigns, attached finished files (deliveries), the brand kit, photo requests, landing
   pages and their tracked links, counting events and daily totals, enquiries, before and after
   numbers, costs, status history, sessions, login links and the rate-limit entries for the
   email.
   Only an anonymous line stays in erasure_log: a SHA-256 hash of the client id, the date and
   whether Harry or the retention rule erased it. No name, email or content is kept. */
import { STATUS_LABELS } from "./config.js";
import { json, normEmail, nowIso, readJson, sha256hex } from "./util.js";
import { deliveryOut } from "./delivery.js";
import { requestOut } from "./photos.js";
import { linkOut, pageOut } from "./pages.js";
import { leadOut, readBaselines, readCosts } from "./roi.js";

const M = {
  badRequest: { sv: "Ogiltig förfrågan.", en: "Bad request." },
  notFound: { sv: "Kunden finns inte.", en: "Client not found." },
  confirm: {
    sv: "Skriv kundens e-postadress exakt för att bekräfta raderingen.",
    en: "Type the client's email address exactly to confirm the erasure."
  }
};

/* Every table that holds rows for a client, and the column that names the client. */
const CLIENT_TABLES = [
  ["files", "client_id"],
  ["intakes", "client_id"],
  ["intake_drafts", "client_id"],
  ["brains", "client_id"],
  ["campaigns", "client_id"],
  ["deliveries", "client_id"],
  ["brand_kits", "client_id"],
  ["photo_requests", "client_id"],
  ["links", "client_id"],
  ["events", "client_id"],
  ["daily_stats", "client_id"],
  ["leads", "client_id"],
  ["baselines", "client_id"],
  ["costs", "client_id"],
  ["pages", "client_id"],
  ["review_items", "client_id"],
  ["reviews", "client_id"],
  ["campaign_log", "client_id"],
  ["uploads", "client_id"],
  ["lang_versions", "client_id"],
  ["lang_items", "client_id"],
  ["lang_notes", "client_id"],
  ["lang_log", "client_id"],
  ["team_access", "client_id"],
  ["consents", "client_id"],
  ["status_history", "client_id"],
  ["sessions", "client_id"],
  ["login_tokens", "client_id"]
];

export function eraseAfter(leftAt, months) {
  if (!leftAt) return null;
  const d = new Date(leftAt);
  if (isNaN(d.getTime())) return null;
  d.setUTCMonth(d.getUTCMonth() + months);
  return d.toISOString();
}

const all = async (env, sql, ...args) => (await env.DB.prepare(sql).bind(...args).all()).results || [];

export async function exportClient(env, cfg, clientId) {
  const c = await env.DB.prepare("SELECT * FROM clients WHERE id = ?").bind(clientId).first();
  if (!c) return json({ error: "not_found", message: M.notFound }, 404);
  const parse = (rows) => rows.map((r) => Object.assign({}, r, { data: JSON.parse(r.data) }));
  const doc = {
    exportType: "taha-growth-client-record",
    exportedAt: nowIso(),
    exportedBy: "admin",
    note: "Everything TAHA Studio Labs Growth Department holds about this client. Files are listed here; download them from the links while signed in as admin.",
    client: {
      id: c.id,
      name: c.name,
      email: c.email,
      language: c.language,
      status: c.status,
      statusLabel: STATUS_LABELS[c.status],
      createdAt: c.created_at,
      invitedAt: c.invited_at,
      lastLoginAt: c.last_login_at,
      leftAt: c.left_at || null,
      eraseAfter: eraseAfter(c.left_at, cfg.retentionMonths)
    },
    consentLog: await all(env, "SELECT version, language, accepted_at AS acceptedAt FROM consents WHERE client_id = ? ORDER BY id ASC", clientId),
    statusHistory: await all(env, "SELECT status, changed_at AS changedAt, changed_by AS changedBy FROM status_history WHERE client_id = ? ORDER BY id ASC", clientId),
    intakeDraft: (await all(env, "SELECT data, answer_language AS answerLanguage, updated_at AS updatedAt FROM intake_drafts WHERE client_id = ?", clientId)).map((r) => Object.assign(r, { data: JSON.parse(r.data) }))[0] || null,
    intakes: parse(await all(env, "SELECT version, submitted_at AS submittedAt, data FROM intakes WHERE client_id = ? ORDER BY version ASC", clientId)),
    files: (await all(env, "SELECT id, section, mime, size, original_name AS name, created_at AS createdAt FROM files WHERE client_id = ? ORDER BY created_at ASC", clientId)).map((f) =>
      Object.assign(f, { url: cfg.siteOrigin + cfg.basePath + "/files/" + f.id })
    ),
    brains: parse(await all(env, "SELECT version, built_from_intake_version AS builtFromIntakeVersion, created_at AS createdAt, data FROM brains WHERE client_id = ? ORDER BY version ASC", clientId)),
    campaigns: parse(await all(env, "SELECT campaign_id AS campaignId, brain_version AS brainVersion, month, status, created_at AS createdAt, updated_at AS updatedAt, data FROM campaigns WHERE client_id = ? ORDER BY created_at ASC", clientId)),
    deliveries: (await all(env, "SELECT * FROM deliveries WHERE client_id = ? ORDER BY added_at ASC", clientId)).map((r) =>
      Object.assign(deliveryOut(r), { url: cfg.siteOrigin + deliveryOut(r).url })
    ),
    photoRequests: (await all(env, "SELECT * FROM photo_requests WHERE client_id = ? ORDER BY created_at ASC", clientId)).map(requestOut),
    brandKit: (await all(env, "SELECT data, updated_at AS updatedAt FROM brand_kits WHERE client_id = ?", clientId)).map((r) => ({ kit: JSON.parse(r.data), updatedAt: r.updatedAt }))[0] || null,
    /* V2 phase G2b */
    landingPages: (await all(env, "SELECT * FROM pages WHERE client_id = ? ORDER BY created_at ASC", clientId)).map((p) => Object.assign(pageOut(p, cfg), { token: undefined })),
    trackedLinks: (await all(env, "SELECT * FROM links WHERE client_id = ? ORDER BY created_at ASC", clientId)).map((l) => linkOut(l, cfg)),
    enquiries: (await all(env, "SELECT * FROM leads WHERE client_id = ? ORDER BY at ASC", clientId)).map(leadOut),
    pageDailyTotals: await all(env, "SELECT page_id AS pageId, day, channel, type, n FROM daily_stats WHERE client_id = ? ORDER BY day ASC", clientId),
    reviews: (await all(env, "SELECT campaign_id AS campaignId, round, state, sent_at AS sentAt, decided_at AS decidedAt FROM reviews WHERE client_id = ? ORDER BY campaign_id, round", clientId)),
    reviewAnswers: (await all(env, "SELECT i.output_key AS outputKey, i.verdict, i.comment, i.at, r.campaign_id AS campaignId, r.round FROM review_items i JOIN reviews r ON r.id = i.review_id WHERE i.client_id = ? ORDER BY i.at", clientId)),
    campaignLog: (await all(env, "SELECT campaign_id AS campaignId, event, detail, at FROM campaign_log WHERE client_id = ? ORDER BY id", clientId)),
    languageReview: {
      items: await all(env, "SELECT id, campaign_id AS campaignId, field_path AS path, label, state, round, sent_at AS sentAt, updated_at AS updatedAt FROM lang_items WHERE client_id = ? ORDER BY sent_at", clientId),
      versions: await all(env, "SELECT item_id AS itemId, kind, text, author, round, at FROM lang_versions WHERE client_id = ? ORDER BY id", clientId),
      notes: await all(env, "SELECT preferred, reason, at FROM lang_notes WHERE client_id = ? ORDER BY id", clientId),
      log: await all(env, "SELECT member_id AS memberId, item_id AS itemId, action, detail, at FROM lang_log WHERE client_id = ? ORDER BY id", clientId)
    },
    pageEventsKept: ((await all(env, "SELECT COUNT(*) AS n FROM events WHERE client_id = ?", clientId))[0] || { n: 0 }).n,
    results: await Promise.all((await all(env, "SELECT DISTINCT campaign_id FROM campaigns WHERE client_id = ?", clientId)).map(async (r) => ({
      campaignId: r.campaign_id,
      baselines: await readBaselines(env, clientId, r.campaign_id),
      costs: await readCosts(env, clientId, r.campaign_id)
    })))
  };
  const slug = String(c.name || "client").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "client";
  return json(doc, 200, { "Content-Disposition": 'attachment; filename="client-record-' + slug + '.json"' });
}

export async function setLeft(request, env, cfg, clientId) {
  const b = await readJson(request, 256);
  if (!b || typeof b.left !== "boolean") return json({ error: "bad_request", message: M.badRequest }, 400);
  const c = await env.DB.prepare("SELECT id FROM clients WHERE id = ?").bind(clientId).first();
  if (!c) return json({ error: "not_found", message: M.notFound }, 404);
  const leftAt = b.left ? nowIso() : null;
  await env.DB.prepare("UPDATE clients SET left_at = ?, updated_at = ? WHERE id = ?").bind(leftAt, nowIso(), clientId).run();
  /* Someone who has left cannot keep signing in to the portal. */
  if (b.left) {
    await env.DB.batch([
      env.DB.prepare("DELETE FROM sessions WHERE client_id = ?").bind(clientId),
      env.DB.prepare("DELETE FROM login_tokens WHERE client_id = ?").bind(clientId)
    ]);
  }
  return json({ ok: true, leftAt, eraseAfter: eraseAfter(leftAt, cfg.retentionMonths) });
}

/* The erasure itself, shared by the admin button and the retention rule. */
export async function eraseClient(env, clientId, reason) {
  const c = await env.DB.prepare("SELECT id, email FROM clients WHERE id = ?").bind(clientId).first();
  if (!c) return null;
  const email = normEmail(c.email);

  /* 0. Unfinished large uploads (Part B) are abandoned first. */
  for (const u of await all(env, "SELECT r2_key, upload_id FROM uploads WHERE client_id = ?", clientId)) {
    try { await env.FILES.resumeMultipartUpload(u.r2_key, u.upload_id).abort(); } catch (e) {}
  }
  /* 1. Files in R2: everything under the client's folder, listed page by page. */
  let filesDeleted = 0;
  let cursor;
  do {
    const page = await env.FILES.list({ prefix: "c/" + clientId + "/", cursor, limit: 500 });
    const keys = (page.objects || []).map((o) => o.key);
    if (keys.length) {
      await env.FILES.delete(keys);
      filesDeleted += keys.length;
    }
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  /* Any file row whose key sits elsewhere (should never happen) is deleted by key too. */
  const stray = await all(env, "SELECT r2_key FROM files WHERE client_id = ? AND r2_key NOT LIKE ? UNION ALL SELECT r2_key FROM deliveries WHERE client_id = ? AND r2_key NOT LIKE ?", clientId, "c/" + clientId + "/%", clientId, "c/" + clientId + "/%");
  if (stray.length) {
    await env.FILES.delete(stray.map((r) => r.r2_key));
    filesDeleted += stray.length;
  }

  /* 2. Rows in D1, children first, then the client, then the anonymous log line. */
  const emailBucket = "e:" + (await sha256hex("email:" + email));
  const stmts = CLIENT_TABLES.map(([t, col]) => env.DB.prepare("DELETE FROM " + t + " WHERE " + col + " = ?").bind(clientId));
  stmts.push(env.DB.prepare("DELETE FROM login_tokens WHERE email = ?").bind(email));
  stmts.push(env.DB.prepare("DELETE FROM sessions WHERE email = ? AND role = 'client'").bind(email));
  stmts.push(env.DB.prepare("DELETE FROM rate_events WHERE bucket = ?").bind(emailBucket));
  stmts.push(env.DB.prepare("DELETE FROM clients WHERE id = ?").bind(clientId));
  stmts.push(env.DB.prepare("INSERT INTO erasure_log (client_id_hash, erased_at, reason) VALUES (?, ?, ?)").bind(await sha256hex("client:" + clientId), nowIso(), reason));
  const res = await env.DB.batch(stmts);
  const rowsDeleted = res.slice(0, -1).reduce((n, r) => n + ((r.meta && r.meta.changes) || 0), 0);

  /* 3. Prove it: count what is left anywhere for this client. */
  const remaining = await traces(env, clientId, email, emailBucket);
  return { filesDeleted, rowsDeleted, remaining };
}

export async function traces(env, clientId, email, emailBucket) {
  const counts = await env.DB.batch(
    CLIENT_TABLES.map(([t, col]) => env.DB.prepare("SELECT COUNT(*) AS n FROM " + t + " WHERE " + col + " = ?").bind(clientId)).concat([
      env.DB.prepare("SELECT COUNT(*) AS n FROM clients WHERE id = ? OR email = ?").bind(clientId, email),
      env.DB.prepare("SELECT COUNT(*) AS n FROM login_tokens WHERE email = ?").bind(email),
      env.DB.prepare("SELECT COUNT(*) AS n FROM sessions WHERE email = ? AND role = 'client'").bind(email),
      env.DB.prepare("SELECT COUNT(*) AS n FROM rate_events WHERE bucket = ?").bind(emailBucket)
    ])
  );
  const rows = counts.reduce((n, r) => n + (r.results[0].n || 0), 0);
  const listed = await env.FILES.list({ prefix: "c/" + clientId + "/", limit: 1 });
  return { rows, files: (listed.objects || []).length };
}

export async function eraseNow(request, env, clientId) {
  const c = await env.DB.prepare("SELECT id, email FROM clients WHERE id = ?").bind(clientId).first();
  if (!c) return json({ error: "not_found", message: M.notFound }, 404);
  const b = await readJson(request, 1024);
  if (!b || normEmail(b.confirm) !== normEmail(c.email)) return json({ error: "confirm", message: M.confirm }, 400);
  const out = await eraseClient(env, clientId, "admin");
  return json({ ok: true, erased: true, filesDeleted: out.filesDeleted, rowsDeleted: out.rowsDeleted, remaining: out.remaining });
}

/* Daily: erase every client who left more than RETENTION_MONTHS ago. */
export async function retentionSweep(env, cfg) {
  const cutoff = new Date();
  cutoff.setUTCMonth(cutoff.getUTCMonth() - cfg.retentionMonths);
  const due = await all(env, "SELECT id FROM clients WHERE left_at IS NOT NULL AND left_at <= ?", cutoff.toISOString());
  for (const r of due) {
    try {
      await eraseClient(env, r.id, "retention");
    } catch (e) {
      console.error("retention erase failed");
    }
  }
  return due.length;
}
