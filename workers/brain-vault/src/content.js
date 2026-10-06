/* V2 Part B: the delivery library. After Mark delivered, the client finds everything ready
   in the portal under Your content (spec section 4): every text with a Copy button (with its
   tracked short link and offer code), the files Harry attached or uploaded, and Download all.

   Client (own id only):
   GET  /portal/campaign/:campaignId    the latest review round, and once delivered the content
                                        with signed file links (10 minutes)
   GET  /dl/:deliveryId?e=&s=           a delivered file; needs the signed link AND a session of
                                        that client (or the admin)
   Admin:
   POST   /admin/upload/:clientId/:campaignId/start            {name, size, mime, title, ai}
   PUT    /admin/upload/:clientId/:campaignId/:uploadId/part?n= one part (8 MB, the last smaller)
   POST   /admin/upload/:clientId/:campaignId/:uploadId/complete {parts:[{partNumber, etag}]}
   DELETE /admin/upload/:clientId/:campaignId/:uploadId        abandon an upload
          Videos (mp4, mov), PDFs and images up to 500 MB, sent from the browser to R2 in parts. */
import { clientView } from "./clientview.js";
import { deliveryOut } from "./delivery.js";
import { extOf } from "./files.js";
import { latestRound, linksFor } from "./review.js";
import { json, newId, nowIso, randomToken, readJson } from "./util.js";

const MB = 1024 * 1024;
export const BIG = { maxBytes: 500 * MB, partBytes: 8 * MB, maxParts: 70 };
const KINDS = {
  mp4: { mime: "video/mp4", kind: "video" },
  mov: { mime: "video/quicktime", kind: "video" },
  pdf: { mime: "application/pdf", kind: "pdf" },
  jpg: { mime: "image/jpeg", kind: "image" },
  jpeg: { mime: "image/jpeg", kind: "image" },
  png: { mime: "image/png", kind: "image" },
  webp: { mime: "image/webp", kind: "image" }
};
const LINK_MINUTES = 10;
const M = {
  badRequest: { sv: "Ogiltig förfrågan.", en: "Bad request." },
  notFound: { sv: "Hittades inte.", en: "Not found." },
  type: { sv: "Bara MP4, MOV, PDF, JPG, PNG eller WebP.", en: "Only MP4, MOV, PDF, JPG, PNG or WebP." },
  size: { sv: "Filen är för stor (högst 500 MB).", en: "The file is too large (500 MB at most)." },
  content: { sv: "Filen stämmer inte med sin filtyp.", en: "The file does not match its type." },
  expired: { sv: "Länken har gått ut. Ladda om sidan.", en: "The link has expired. Reload the page." }
};
const all = async (env, sql, ...args) => (await env.DB.prepare(sql).bind(...args).all()).results || [];
const enc = new TextEncoder();

async function signingKey(env) {
  let r = await env.DB.prepare("SELECT value FROM secrets WHERE name = 'download-links'").first();
  if (!r) {
    await env.DB.prepare("INSERT OR IGNORE INTO secrets (name, value) VALUES ('download-links', ?)").bind(randomToken(32)).run();
    r = await env.DB.prepare("SELECT value FROM secrets WHERE name = 'download-links'").first();
  }
  return crypto.subtle.importKey("raw", enc.encode(r.value), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
}

async function sign(env, id, exp) {
  const key = await signingKey(env);
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(id + "." + exp)));
  return [...mac.slice(0, 16)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function signedUrl(env, cfg, id) {
  const exp = Math.floor(Date.now() / 1000) + LINK_MINUTES * 60;
  return cfg.basePath + "/dl/" + id + "?e=" + exp + "&s=" + (await sign(env, id, exp));
}

/* The client's view of one campaign: the latest review round, and the content once delivered. */
export async function portalCampaign(env, cfg, auth, campaignId) {
  const row = await env.DB.prepare("SELECT data, status FROM campaigns WHERE client_id = ? AND campaign_id = ?").bind(auth.clientId, campaignId).first();
  if (!row) return json({ error: "not_found", message: M.notFound }, 404);
  const r = await latestRound(env, auth.clientId, campaignId);
  const delivered = row.status === "delivered";
  if (!r && !delivered) return json({ error: "not_found", message: M.notFound }, 404);
  let review = null;
  if (r) {
    const items = await all(env, "SELECT output_key, verdict, comment FROM review_items WHERE review_id = ?", r.id);
    review = { round: r.round, state: r.state, sentAt: r.sent_at, decidedAt: r.decided_at || null, view: JSON.parse(r.data), items: items.map((i) => ({ key: i.output_key, verdict: i.verdict, comment: i.comment || "" })) };
  }
  let content = null;
  if (delivered) {
    const doc = JSON.parse(row.data);
    const lk = await linksFor(env, auth.clientId, campaignId);
    const view = clientView(doc, { links: lk.links, origin: cfg.siteOrigin, pageUrl: lk.pageUrl ? cfg.siteOrigin + lk.pageUrl : "" });
    const share = lk.links.find((l) => l.output_key === "share.main");
    const files = await all(env, "SELECT * FROM deliveries WHERE client_id = ? AND campaign_id = ? ORDER BY added_at ASC", auth.clientId, campaignId);
    const out = [];
    for (const f of files) {
      const d = deliveryOut(f);
      out.push({ id: d.id, title: d.title, kind: d.kind, mime: d.mime, size: d.size, name: d.name || d.id, aiImage: d.aiImage, width: d.width, height: d.height, url: await signedUrl(env, cfg, d.id) });
    }
    content = {
      view,
      pageUrl: lk.pageUrl ? cfg.siteOrigin + lk.pageUrl : "",
      shortUrl: share && lk.pageUrl ? cfg.siteOrigin + "/go/r/" + share.code : "",
      files: out,
      linksExpireMinutes: LINK_MINUTES
    };
  }
  return json({ campaignId, name: (review && review.view.name) || JSON.parse(row.data).name || "", month: JSON.parse(row.data).month, delivered, review, content });
}

export async function download(env, auth, id, url) {
  const exp = parseInt(url.searchParams.get("e") || "0", 10);
  const sig = url.searchParams.get("s") || "";
  if (!exp || exp < Math.floor(Date.now() / 1000)) return json({ error: "expired", message: M.expired }, 403);
  if (sig !== (await sign(env, id, exp))) return json({ error: "not_found", message: M.notFound }, 404);
  const f = await env.DB.prepare("SELECT d.*, c.status AS cstatus FROM deliveries d JOIN campaigns c ON c.client_id = d.client_id AND c.campaign_id = d.campaign_id WHERE d.id = ?").bind(id).first();
  if (!f || (auth.role !== "admin" && (f.client_id !== auth.clientId || f.cstatus !== "delivered"))) return json({ error: "not_found", message: M.notFound }, 404);
  const obj = await env.FILES.get(f.r2_key);
  if (!obj) return json({ error: "not_found", message: M.notFound }, 404);
  const ext = extOf(f.original_name || "") || (f.mime.split("/")[1] || "bin").replace("quicktime", "mov").replace("jpeg", "jpg");
  const base = String(f.title || f.original_name || "file").replace(/\.[a-z0-9]{1,5}$/i, "").replace(/[^\w.\- ]+/g, "_").slice(0, 80) || "file";
  return new Response(obj.body, {
    headers: {
      "Content-Type": f.mime,
      "Content-Length": String(obj.size),
      "Content-Disposition": 'attachment; filename="' + base + "." + ext + '"',
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox"
    }
  });
}

/* ---------- admin: large files in parts ---------- */

function magicOk(kind, ext, b) {
  const at = (i, s) => [...s].every((ch, k) => b[i + k] === ch.charCodeAt(0));
  if (ext === "pdf") return at(0, "%PDF");
  if (kind === "video") return at(4, "ftyp") || at(4, "moov") || at(4, "wide") || at(4, "mdat") || at(4, "free");
  if (ext === "png") return b[0] === 0x89 && at(1, "PNG");
  if (ext === "jpg" || ext === "jpeg") return b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
  if (ext === "webp") return at(0, "RIFF") && at(8, "WEBP");
  return false;
}

export async function startUpload(request, env, clientId, campaignId) {
  const c = await env.DB.prepare("SELECT 1 FROM campaigns WHERE client_id = ? AND campaign_id = ?").bind(clientId, campaignId).first();
  if (!c) return json({ error: "not_found", message: M.notFound }, 404);
  const b = await readJson(request, 4096);
  if (!b) return json({ error: "bad_request", message: M.badRequest }, 400);
  const name = String(b.name || "").slice(0, 200);
  const t = KINDS[extOf(name)];
  if (!t) return json({ error: "type", message: M.type }, 415);
  const size = parseInt(b.size, 10);
  if (!size || size > BIG.maxBytes) return json({ error: "size", message: M.size }, 413);
  const id = newId("d", 16);
  const key = "c/" + clientId + "/" + id;
  const mp = await env.FILES.createMultipartUpload(key, { httpMetadata: { contentType: t.mime } });
  await env.DB.prepare("INSERT INTO uploads (id, client_id, campaign_id, r2_key, upload_id, name, title, mime, kind, size, ai_image, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
    .bind(id, clientId, campaignId, key, mp.uploadId, name, String(b.title || "").slice(0, 200), t.mime, t.kind, size, b.ai ? 1 : 0, nowIso()).run();
  return json({ ok: true, uploadId: id, partBytes: BIG.partBytes, parts: Math.ceil(size / BIG.partBytes) }, 201);
}

async function uploadRow(env, clientId, campaignId, id) {
  if (!/^d_[a-z0-9]{4,32}$/.test(id)) return null;
  return env.DB.prepare("SELECT * FROM uploads WHERE id = ? AND client_id = ? AND campaign_id = ?").bind(id, clientId, campaignId).first();
}

export async function uploadPart(request, env, clientId, campaignId, id, url) {
  const u = await uploadRow(env, clientId, campaignId, id);
  if (!u) return json({ error: "not_found", message: M.notFound }, 404);
  const n = parseInt(url.searchParams.get("n") || "0", 10);
  if (!n || n < 1 || n > BIG.maxParts) return json({ error: "bad_request", message: M.badRequest }, 400);
  const len = parseInt(request.headers.get("Content-Length") || "0", 10);
  if (!len || len > BIG.partBytes) return json({ error: "size", message: M.size }, 413);
  const buf = await request.arrayBuffer();
  if (!buf.byteLength || buf.byteLength > BIG.partBytes) return json({ error: "size", message: M.size }, 413);
  if (n === 1 && !magicOk(u.kind, extOf(u.name), new Uint8Array(buf.slice(0, 16)))) return json({ error: "content", message: M.content }, 415);
  const mp = env.FILES.resumeMultipartUpload(u.r2_key, u.upload_id);
  const part = await mp.uploadPart(n, buf);
  return json({ ok: true, partNumber: part.partNumber, etag: part.etag });
}

export async function completeUpload(request, env, clientId, campaignId, id) {
  const u = await uploadRow(env, clientId, campaignId, id);
  if (!u) return json({ error: "not_found", message: M.notFound }, 404);
  const b = await readJson(request, 32 * 1024);
  if (!b || !Array.isArray(b.parts) || !b.parts.length || b.parts.length > BIG.maxParts) return json({ error: "bad_request", message: M.badRequest }, 400);
  const parts = b.parts.map((p) => ({ partNumber: parseInt(p.partNumber, 10), etag: String(p.etag || "") })).sort((a, c) => a.partNumber - c.partNumber);
  const mp = env.FILES.resumeMultipartUpload(u.r2_key, u.upload_id);
  const obj = await mp.complete(parts);
  const size = obj.size;
  if (size > BIG.maxBytes) {
    await env.FILES.delete(u.r2_key);
    await env.DB.prepare("DELETE FROM uploads WHERE id = ?").bind(id).run();
    return json({ error: "size", message: M.size }, 413);
  }
  const t = nowIso();
  await env.DB.batch([
    env.DB.prepare("INSERT INTO deliveries (id, client_id, campaign_id, visual_id, title, kind, ai_image, mime, size, r2_key, original_name, added_at) VALUES (?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?)")
      .bind(id, clientId, campaignId, u.title, u.kind, u.ai_image, u.mime, size, u.r2_key, u.name, t),
    env.DB.prepare("DELETE FROM uploads WHERE id = ?").bind(id)
  ]);
  const row = await env.DB.prepare("SELECT * FROM deliveries WHERE id = ?").bind(id).first();
  return json({ ok: true, delivery: deliveryOut(row) }, 201);
}

export async function abortUpload(env, clientId, campaignId, id) {
  const u = await uploadRow(env, clientId, campaignId, id);
  if (!u) return json({ error: "not_found", message: M.notFound }, 404);
  try { await env.FILES.resumeMultipartUpload(u.r2_key, u.upload_id).abort(); } catch (e) {}
  await env.DB.prepare("DELETE FROM uploads WHERE id = ?").bind(id).run();
  return json({ ok: true });
}
