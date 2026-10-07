/* V2 Part E: client video uploads (section Videos / Videoklipp).

   Client, own files only, consent of the current version required:
   GET    /portal/videos                    her clips, and unfinished uploads she can continue
   POST   /portal/videos/start              { name, size, duration }  mp4 or mov, at most 60 s and
                                            200 MB, up to 10 clips (unfinished ones count)
   GET    /portal/videos/:id                the parts already received, to continue an upload
                                            after a dropped connection or a reload
   PUT    /portal/videos/:id/part?n=        one part, 5 MB (the last one smaller)
   POST   /portal/videos/:id/complete       joins the parts; the Vault reads the clip's length
                                            from its header and refuses one over 60 seconds
   DELETE /portal/videos/:id                abandons an unfinished upload
   A finished clip is an ordinary client file (section "videos"): she removes it with
   DELETE /files/:id, Harry downloads it from the Intake tab. No processing on the server, and the
   clips never go to an AI provider (the Business Brain sees their names only).
   The daily job aborts uploads left unfinished for two days. */
import { consentOk } from "./portal.js";
import { durationOf, looksLikeMp4, r2Reader } from "./mp4.js";
import { extOf, r2Key } from "./files.js";
import { json, newId, nowIso, readJson } from "./util.js";

const MB = 1024 * 1024;
export const VIDEO = { maxBytes: 200 * MB, maxSeconds: 60, slackSeconds: 0.5, maxCount: 10, partBytes: 5 * MB, staleHours: 48 };
const MIME = { mp4: "video/mp4", mov: "video/quicktime" };
const MARK = "videos";

const M = {
  badRequest: { sv: "Ogiltig förfrågan.", en: "Bad request." },
  consent: { sv: "Du behöver godkänna informationen om personuppgifter först.", en: "Please accept the data information first." },
  notFound: { sv: "Hittades inte.", en: "Not found." },
  type: { sv: "Bara MP4- eller MOV-filer (som mobilen spelar in).", en: "Only MP4 or MOV files (what your phone records)." },
  size: { sv: "Klippet är för stort. Högst 200 MB per klipp.", en: "The clip is too large. 200 MB per clip at most." },
  long: { sv: "Klippet är för långt. Högst 60 sekunder per klipp.", en: "The clip is too long. 60 seconds per clip at most." },
  count: { sv: "Du har redan 10 videoklipp. Ta bort ett för att lägga till ett nytt.", en: "You already have 10 video clips. Remove one to add another." },
  content: { sv: "Filen ser inte ut som en video.", en: "The file does not look like a video." },
  parts: { sv: "Alla delar har inte kommit fram. Fortsätt uppladdningen.", en: "Not every part has arrived. Continue the upload." }
};

const all = async (env, sql, ...args) => (await env.DB.prepare(sql).bind(...args).all()).results || [];
const partsOf = (size) => Math.max(1, Math.ceil(size / VIDEO.partBytes));

export function videoOut(f) {
  return { id: f.id, name: f.original_name, mime: f.mime, size: f.size, duration: f.duration_s == null ? null : f.duration_s, createdAt: f.created_at };
}

async function pendingRow(env, clientId, id) {
  if (!/^f_[a-z0-9]{4,32}$/.test(id)) return null;
  return env.DB.prepare("SELECT * FROM uploads WHERE id = ? AND client_id = ? AND campaign_id = ?").bind(id, clientId, MARK).first();
}

async function guard(env, cfg, auth) {
  if (!(await consentOk(env, cfg, auth.clientId))) return json({ error: "consent_required", message: M.consent }, 403);
  return null;
}

export async function listVideos(env, cfg, auth) {
  const videos = (await all(env, "SELECT * FROM files WHERE client_id = ? AND section = 'videos' ORDER BY created_at ASC", auth.clientId)).map(videoOut);
  const pending = [];
  for (const u of await all(env, "SELECT * FROM uploads WHERE client_id = ? AND campaign_id = ? ORDER BY created_at ASC", auth.clientId, MARK)) {
    const done = await all(env, "SELECT n, bytes FROM upload_parts WHERE upload_id = ?", u.id);
    pending.push({ id: u.id, name: u.name, size: u.size, parts: partsOf(u.size), partsDone: done.map((p) => p.n), bytesDone: done.reduce((a, p) => a + p.bytes, 0), startedAt: u.created_at });
  }
  return json({ videos, pending, limits: { maxBytes: VIDEO.maxBytes, maxSeconds: VIDEO.maxSeconds, maxCount: VIDEO.maxCount, partBytes: VIDEO.partBytes } });
}

export async function startVideo(request, env, cfg, auth) {
  const g = await guard(env, cfg, auth);
  if (g) return g;
  const b = await readJson(request, 4096);
  if (!b) return json({ error: "bad_request", message: M.badRequest }, 400);
  const name = String(b.name || "").replace(/[\u0000-\u001f]/g, "").slice(0, 200);
  const mime = MIME[extOf(name)];
  if (!mime) return json({ error: "type", message: M.type }, 415);
  const size = parseInt(b.size, 10);
  if (!size || size < 1) return json({ error: "bad_request", message: M.badRequest }, 400);
  if (size > VIDEO.maxBytes) return json({ error: "size", message: M.size }, 413);
  const dur = b.duration == null || b.duration === "" ? null : Number(b.duration);
  if (dur != null && Number.isFinite(dur) && dur > VIDEO.maxSeconds + VIDEO.slackSeconds) return json({ error: "long", message: M.long }, 413);
  const n = (await env.DB.prepare("SELECT (SELECT COUNT(*) FROM files WHERE client_id = ?1 AND section = 'videos') + (SELECT COUNT(*) FROM uploads WHERE client_id = ?1 AND campaign_id = 'videos') AS n").bind(auth.clientId).first()).n;
  if (n >= VIDEO.maxCount) return json({ error: "count", message: M.count }, 409);
  const id = newId("f", 16);
  const key = r2Key(auth.clientId, id);
  const mp = await env.FILES.createMultipartUpload(key, { httpMetadata: { contentType: mime } });
  await env.DB.prepare("INSERT INTO uploads (id, client_id, campaign_id, r2_key, upload_id, name, title, mime, kind, size, ai_image, created_at) VALUES (?, ?, ?, ?, ?, ?, '', ?, 'video', ?, 0, ?)")
    .bind(id, auth.clientId, MARK, key, mp.uploadId, name, mime, size, nowIso()).run();
  return json({ ok: true, id, partBytes: VIDEO.partBytes, parts: partsOf(size), partsDone: [] }, 201);
}

export async function videoState(env, cfg, auth, id) {
  const u = await pendingRow(env, auth.clientId, id);
  if (!u) return json({ error: "not_found", message: M.notFound }, 404);
  const done = await all(env, "SELECT n, bytes FROM upload_parts WHERE upload_id = ?", id);
  return json({ id, name: u.name, size: u.size, partBytes: VIDEO.partBytes, parts: partsOf(u.size), partsDone: done.map((p) => p.n), bytesDone: done.reduce((a, p) => a + p.bytes, 0) });
}

export async function videoPart(request, env, cfg, auth, id, url) {
  const g = await guard(env, cfg, auth);
  if (g) return g;
  const u = await pendingRow(env, auth.clientId, id);
  if (!u) return json({ error: "not_found", message: M.notFound }, 404);
  const total = partsOf(u.size);
  const n = parseInt(url.searchParams.get("n") || "0", 10);
  if (!n || n < 1 || n > total) return json({ error: "bad_request", message: M.badRequest }, 400);
  /* Every part but the last is exactly partBytes; the last is what is left. */
  const expected = n < total ? VIDEO.partBytes : u.size - VIDEO.partBytes * (total - 1);
  const len = parseInt(request.headers.get("Content-Length") || "0", 10);
  if (len && len !== expected) return json({ error: "size", message: M.size }, 413);
  const buf = await request.arrayBuffer();
  if (buf.byteLength !== expected) return json({ error: "size", message: M.size }, 413);
  if (n === 1 && !looksLikeMp4(new Uint8Array(buf.slice(0, 16)))) return json({ error: "content", message: M.content }, 415);
  const part = await env.FILES.resumeMultipartUpload(u.r2_key, u.upload_id).uploadPart(n, buf);
  await env.DB.prepare("INSERT INTO upload_parts (upload_id, client_id, n, etag, bytes) VALUES (?, ?, ?, ?, ?) ON CONFLICT(upload_id, n) DO UPDATE SET etag = excluded.etag, bytes = excluded.bytes")
    .bind(id, auth.clientId, n, part.etag, buf.byteLength).run();
  return json({ ok: true, partNumber: n });
}

async function dropPending(env, u) {
  try { await env.FILES.resumeMultipartUpload(u.r2_key, u.upload_id).abort(); } catch (e) {}
  await env.DB.batch([
    env.DB.prepare("DELETE FROM upload_parts WHERE upload_id = ?").bind(u.id),
    env.DB.prepare("DELETE FROM uploads WHERE id = ?").bind(u.id)
  ]);
}

export async function completeVideo(env, cfg, auth, id) {
  const g = await guard(env, cfg, auth);
  if (g) return g;
  const u = await pendingRow(env, auth.clientId, id);
  if (!u) return json({ error: "not_found", message: M.notFound }, 404);
  const total = partsOf(u.size);
  const parts = await all(env, "SELECT n, etag FROM upload_parts WHERE upload_id = ? ORDER BY n", id);
  if (parts.length !== total) return json({ error: "parts", message: M.parts, partsDone: parts.map((p) => p.n) }, 409);
  const obj = await env.FILES.resumeMultipartUpload(u.r2_key, u.upload_id).complete(parts.map((p) => ({ partNumber: p.n, etag: p.etag })));
  const drop = async () => {
    await env.FILES.delete(u.r2_key);
    await env.DB.batch([env.DB.prepare("DELETE FROM upload_parts WHERE upload_id = ?").bind(id), env.DB.prepare("DELETE FROM uploads WHERE id = ?").bind(id)]);
  };
  if (obj.size > VIDEO.maxBytes || obj.size !== u.size) { await drop(); return json({ error: "size", message: M.size }, 413); }
  const seconds = await durationOf(r2Reader(env.FILES, u.r2_key), obj.size).catch(() => null);
  if (seconds != null && seconds > VIDEO.maxSeconds + VIDEO.slackSeconds) { await drop(); return json({ error: "long", message: M.long, seconds: Math.round(seconds * 10) / 10 }, 413); }
  const t = nowIso();
  await env.DB.batch([
    env.DB.prepare("INSERT INTO files (id, client_id, section, mime, size, r2_key, original_name, created_at, duration_s) VALUES (?, ?, 'videos', ?, ?, ?, ?, ?, ?)")
      .bind(id, auth.clientId, u.mime, obj.size, u.r2_key, u.name, t, seconds == null ? null : Math.round(seconds * 10) / 10),
    env.DB.prepare("DELETE FROM upload_parts WHERE upload_id = ?").bind(id),
    env.DB.prepare("DELETE FROM uploads WHERE id = ?").bind(id)
  ]);
  const f = await env.DB.prepare("SELECT * FROM files WHERE id = ?").bind(id).first();
  return json({ ok: true, video: videoOut(f) }, 201);
}

export async function abortVideo(env, cfg, auth, id) {
  const u = await pendingRow(env, auth.clientId, id);
  if (!u) return json({ error: "not_found", message: M.notFound }, 404);
  await dropPending(env, u);
  return json({ ok: true });
}

/* Daily job: unfinished uploads (clients' videos and Harry's delivery files) older than two days. */
export async function staleUploadSweep(env) {
  const cutoff = new Date(Date.now() - VIDEO.staleHours * 3600 * 1000).toISOString();
  for (const u of await all(env, "SELECT * FROM uploads WHERE created_at < ?", cutoff)) await dropPending(env, u);
}
