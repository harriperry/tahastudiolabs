/* Two kinds of access.
   Client: a private link. The link holds a key made with HMAC-SHA256 over the project id and a
     key version, using the LINK_SECRET Worker secret. Nothing secret is stored in the database,
     the same link can be re-sent, and bumping the key version kills a leaked link.
     The key travels in the URL fragment (#k=...), so it never reaches server logs or Referer
     headers, and the page sends it as the X-Project-Key header.
   Admin: magic link by email to an address in ADMIN_EMAILS, then an HttpOnly session cookie.
     Login tokens are 32 random bytes, stored only as a SHA-256 hash, single use, 15 minutes. */
import { ADMIN_COOKIE } from "./config.js";
import { composeAdminLogin, sendMail } from "./mail.js";
import { getCookie, hmacB64, normEmail, nowMs, randomToken, safeEqual, sha256hex } from "./util.js";

export async function makeKey(cfg, projectId, version) {
  if (!cfg.linkSecret) throw new Error("LINK_SECRET is not set");
  return projectId + "." + (await hmacB64(cfg.linkSecret, "pk|" + projectId + "|" + version));
}

export function clientLink(cfg, key) {
  return cfg.clientBase + "#k=" + key;
}

/* Returns the project row when the X-Project-Key header is valid, otherwise null. */
export async function authProject(request, env, cfg) {
  const header = request.headers.get("X-Project-Key") || "";
  const dot = header.indexOf(".");
  if (dot < 4 || header.length > 120) return null;
  const id = header.slice(0, dot);
  if (!/^pj_[a-z0-9]{4,32}$/.test(id)) return null;
  const project = await env.DB.prepare("SELECT * FROM projects WHERE id = ?").bind(id).first();
  if (!project) return null;
  const expected = await makeKey(cfg, id, project.key_version);
  return safeEqual(expected, header) ? project : null;
}

export function isAdminEmail(cfg, email) {
  return cfg.adminEmails.includes(normEmail(email));
}

export function adminCookie(cfg, token) {
  return ADMIN_COOKIE + "=" + token + "; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=" + cfg.sessionDays * 86400;
}

export function clearAdminCookie() {
  return ADMIN_COOKIE + "=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0";
}

/* Sliding window limiter. Buckets hold hashes, never raw emails or IPs. */
export async function allow(env, bucketName, max, windowMs = 3600 * 1000) {
  const bucket = "b:" + (await sha256hex(bucketName));
  const since = nowMs() - windowMs;
  const row = await env.DB.prepare("SELECT COUNT(*) AS n FROM rate_events WHERE bucket = ? AND at > ?").bind(bucket, since).first();
  if (row.n >= max) return false;
  await env.DB.prepare("INSERT INTO rate_events (bucket, at) VALUES (?, ?)").bind(bucket, nowMs()).run();
  return true;
}

export async function issueAdminLink(env, cfg, email) {
  if (!isAdminEmail(cfg, email)) return;
  const token = randomToken(32);
  const t = nowMs();
  await env.DB.prepare("INSERT INTO login_tokens (token_hash, email, created_at, expires_at) VALUES (?, ?, ?, ?)")
    .bind(await sha256hex(token), email, t, t + cfg.tokenTtlMinutes * 60 * 1000)
    .run();
  const mail = composeAdminLogin(cfg, { link: cfg.studioBase + "/verify#t=" + token });
  try {
    await sendMail(cfg, env, { to: email, ...mail });
  } catch (e) {
    console.error("admin login email failed: " + e.message);
  }
}

/* Atomically marks the token used; a second click always fails. */
export async function consumeToken(env, token) {
  if (!token || token.length > 100) return null;
  const t = nowMs();
  return (
    (await env.DB.prepare("UPDATE login_tokens SET used_at = ? WHERE token_hash = ? AND used_at IS NULL AND expires_at > ? RETURNING email")
      .bind(t, await sha256hex(token), t)
      .first()) || null
  );
}

export async function createSession(env, cfg, email) {
  const token = randomToken(32);
  const t = nowMs();
  await env.DB.prepare("INSERT INTO sessions (session_hash, email, created_at, expires_at) VALUES (?, ?, ?, ?)")
    .bind(await sha256hex(token), email, t, t + cfg.sessionDays * 86400 * 1000)
    .run();
  return token;
}

export async function destroySession(env, request) {
  const token = getCookie(request, ADMIN_COOKIE);
  if (token) await env.DB.prepare("DELETE FROM sessions WHERE session_hash = ?").bind(await sha256hex(token)).run();
}

/* The signed in admin email, or null. */
export async function getAdmin(request, env, cfg) {
  const token = getCookie(request, ADMIN_COOKIE);
  if (!token || token.length > 100) return null;
  const s = await env.DB.prepare("SELECT email FROM sessions WHERE session_hash = ? AND expires_at > ?")
    .bind(await sha256hex(token), nowMs())
    .first();
  return s && isAdminEmail(cfg, s.email) ? s.email : null;
}

export async function cleanup(env) {
  const t = nowMs();
  await env.DB.batch([
    env.DB.prepare("DELETE FROM login_tokens WHERE expires_at < ?").bind(t - 86400 * 1000),
    env.DB.prepare("DELETE FROM sessions WHERE expires_at < ?").bind(t),
    env.DB.prepare("DELETE FROM rate_events WHERE at < ?").bind(t - 2 * 3600 * 1000)
  ]);
}
