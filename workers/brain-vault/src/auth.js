/* Magic link authentication with two roles.
   client: an invited business; can only ever touch its own client record.
   admin:  an email listed in ADMIN_EMAILS (Harry); can touch everything.

   Login tokens: 32 random bytes, sent once by email, stored only as a SHA-256 hash,
   single use, valid LOGIN_TOKEN_TTL_MINUTES (15).
   The token travels in the URL fragment (#t=...), so it never reaches server logs or
   Referer headers, and it is only consumed by an explicit POST from the verify page.
   This stops email link scanners from burning the link before the person clicks it.

   Sessions: 32 random bytes in an HttpOnly, Secure, SameSite=Lax cookie with the __Host-
   prefix, valid SESSION_DAYS (30), stored only as a SHA-256 hash.

   ScriptForge bridge: when SCRIPTFORGE_ADMIN_BRIDGE is "on" and there is no Vault session,
   the Worker asks ScriptForge's own /api/me (forwarding the request's cookies) who is signed in.
   If that email is in ADMIN_EMAILS the request is treated as admin. Client role is never
   granted through the bridge. */
import { SESSION_COOKIE } from "./config.js";
import { getMemberAuth, memberLoginLink } from "./team.js";
import { getCookie, normEmail, nowIso, nowMs, randomToken, sha256hex } from "./util.js";
import { composeEmail, sendMail } from "./mail.js";

export function isAdminEmail(cfg, email) {
  return cfg.adminEmails.includes(normEmail(email));
}

export function sessionCookie(cfg, token) {
  return (
    SESSION_COOKIE +
    "=" +
    token +
    "; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=" +
    cfg.sessionDays * 86400
  );
}

export function clearSessionCookie() {
  return SESSION_COOKIE + "=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0";
}

/* Sliding one-hour window. Buckets hold hashes, never raw emails or IPs. */
export async function checkRateLimit(env, cfg, email, ip) {
  const since = nowMs() - 3600 * 1000;
  const eb = "e:" + (await sha256hex("email:" + email));
  const ib = "i:" + (await sha256hex("ip:" + ip));
  const [e, i] = await env.DB.batch([
    env.DB.prepare("SELECT COUNT(*) AS n FROM rate_events WHERE bucket = ? AND at > ?").bind(eb, since),
    env.DB.prepare("SELECT COUNT(*) AS n FROM rate_events WHERE bucket = ? AND at > ?").bind(ib, since)
  ]);
  const en = e.results[0].n;
  const inn = i.results[0].n;
  if (en >= cfg.rateLimitPerEmailHour || inn >= cfg.rateLimitPerIpHour) return false;
  const t = nowMs();
  await env.DB.batch([
    env.DB.prepare("INSERT INTO rate_events (bucket, at) VALUES (?, ?)").bind(eb, t),
    env.DB.prepare("INSERT INTO rate_events (bucket, at) VALUES (?, ?)").bind(ib, t)
  ]);
  return true;
}

export async function createLoginToken(env, cfg, { email, role, clientId, purpose }) {
  const token = randomToken(32);
  const hash = await sha256hex(token);
  const t = nowMs();
  await env.DB.prepare(
    "INSERT INTO login_tokens (token_hash, email, role, client_id, purpose, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
  )
    .bind(hash, email, role, clientId || null, purpose, t, t + cfg.tokenTtlMinutes * 60 * 1000)
    .run();
  return token;
}

export function verifyLink(cfg, token) {
  return cfg.siteOrigin + cfg.basePath + "/auth/verify#t=" + token;
}

export function signinUrl(cfg, role) {
  return cfg.siteOrigin + (role === "admin" ? cfg.adminHome : cfg.clientHome);
}

/* Runs after the neutral response has been sent, so invited and uninvited emails
   take the same time to answer. */
export async function issueLoginLink(env, cfg, email, preferredLang) {
  let role = null;
  let client = null;
  if (isAdminEmail(cfg, email)) {
    role = "admin";
  } else {
    client = await env.DB.prepare("SELECT id, name, language, left_at FROM clients WHERE email = ?").bind(email).first();
    /* A client who has left gets no login link (the reply stays the same neutral message). */
    if (client && !client.left_at) role = "client";
  }
  if (!role) {
    /* V2 Part H: a team member (language reviewer) gets their own kind of link. */
    try { await memberLoginLink(env, cfg, email); } catch (e) { console.error("member link failed: " + e.message); }
    return;
  }
  const token = await createLoginToken(env, cfg, { email, role, clientId: client && client.id, purpose: "login" });
  const language = client ? client.language : preferredLang === "en" ? "en" : "sv";
  const mail = composeEmail("login", cfg, {
    link: verifyLink(cfg, token),
    name: client ? client.name : "",
    language,
    signinUrl: signinUrl(cfg, role)
  });
  try {
    await sendMail(cfg, env, { to: email, ...mail });
  } catch (e) {
    console.error("login email failed: " + e.message);
  }
}

/* Atomically marks the token used. Returns the token row, or null if it is unknown,
   used or expired. A second click therefore always fails. */
export async function consumeToken(env, token) {
  if (!token || token.length > 100) return null;
  const hash = await sha256hex(token);
  const t = nowMs();
  const row = await env.DB.prepare(
    "UPDATE login_tokens SET used_at = ? WHERE token_hash = ? AND used_at IS NULL AND expires_at > ? RETURNING email, role, client_id, purpose"
  )
    .bind(t, hash, t)
    .first();
  return row || null;
}

export async function createSession(env, cfg, { role, clientId, email }) {
  const token = randomToken(32);
  const hash = await sha256hex(token);
  const t = nowMs();
  await env.DB.prepare(
    "INSERT INTO sessions (session_hash, role, client_id, email, created_at, expires_at, last_seen) VALUES (?, ?, ?, ?, ?, ?, ?)"
  )
    .bind(hash, role, clientId || null, email, t, t + cfg.sessionDays * 86400 * 1000, t)
    .run();
  if (clientId) {
    await env.DB.prepare("UPDATE clients SET last_login_at = ? WHERE id = ?").bind(nowIso(), clientId).run();
  }
  return token;
}

export async function destroySession(env, request) {
  const token = getCookie(request, SESSION_COOKIE);
  if (!token) return;
  const hash = await sha256hex(token);
  await env.DB.prepare("DELETE FROM sessions WHERE session_hash = ?").bind(hash).run();
}

/* Who is calling? Returns { role, email, clientId, via, setCookies } or null. */
export async function getAuth(request, env, cfg) {
  const token = getCookie(request, SESSION_COOKIE);
  if (token && token.length <= 100) {
    const hash = await sha256hex(token);
    const t = nowMs();
    const s = await env.DB.prepare(
      "SELECT role, client_id, email, last_seen FROM sessions WHERE session_hash = ? AND expires_at > ?"
    )
      .bind(hash, t)
      .first();
    if (s) {
      if (s.role === "admin" && !isAdminEmail(cfg, s.email)) {
        /* Removed from ADMIN_EMAILS since the session started: no longer admin. */
      } else {
        if (t - s.last_seen > 3600 * 1000) {
          await env.DB.prepare("UPDATE sessions SET last_seen = ? WHERE session_hash = ?").bind(t, hash).run();
        }
        return { role: s.role, email: s.email, clientId: s.client_id, via: "vault", setCookies: [] };
      }
    }
  }
  /* V2 Part H: a team member's session (language reviewer). */
  const member = await getMemberAuth(request, env);
  if (member) return member;
  if (cfg.bridgeOn && getCookie(request, "sf_sid")) {
    return scriptforgeAdmin(request, cfg);
  }
  return null;
}

async function scriptforgeAdmin(request, cfg) {
  try {
    const res = await fetch(cfg.scriptforgeMeUrl, {
      method: "GET",
      headers: { Cookie: request.headers.get("Cookie") || "", Accept: "application/json" },
      redirect: "manual"
    });
    if (res.status !== 200) return null;
    const me = await res.json();
    if (!me || !isAdminEmail(cfg, me.email)) return null;
    const setCookies = typeof res.headers.getSetCookie === "function" ? res.headers.getSetCookie() : [];
    return { role: "admin", email: normEmail(me.email), clientId: null, via: "scriptforge", setCookies };
  } catch (e) {
    return null;
  }
}

export async function cleanup(env) {
  const t = nowMs();
  await env.DB.batch([
    env.DB.prepare("DELETE FROM login_tokens WHERE expires_at < ?").bind(t - 86400 * 1000),
    env.DB.prepare("DELETE FROM sessions WHERE expires_at < ?").bind(t),
    env.DB.prepare("DELETE FROM rate_events WHERE at < ?").bind(t - 2 * 3600 * 1000)
  ]);
}
