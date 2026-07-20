/* Shared helpers for ScriptForge Pages Functions.
   Data-minimization contract: these functions may touch ONLY email, credentials (via
   Supabase Auth), subscription status, license redemptions, and session ids.
   They must NEVER accept, forward, or log script content or Anthropic API keys. */

export function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...extraHeaders }
  });
}

export function getCookies(request) {
  const out = {};
  (request.headers.get("Cookie") || "").split(";").forEach(p => {
    const i = p.indexOf("="); if (i > -1) out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim());
  });
  return out;
}

export function cookie(name, value, maxAge) {
  // Brief §2: httpOnly, Secure, SameSite=Strict — session tokens never in localStorage.
  return `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${maxAge}`;
}
export function clearCookie(name) { return `${name}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`; }

export function authCookieHeaders(at, rt, sid) {
  const h = new Headers({ "Content-Type": "application/json", "Cache-Control": "no-store" });
  h.append("Set-Cookie", cookie("sf_at", at, 3600));
  h.append("Set-Cookie", cookie("sf_rt", rt, 60 * 60 * 24 * 30));
  h.append("Set-Cookie", cookie("sf_sid", sid, 60 * 60 * 24 * 30));
  return h;
}
export function clearAuthHeaders() {
  const h = new Headers({ "Content-Type": "application/json", "Cache-Control": "no-store" });
  ["sf_at", "sf_rt", "sf_sid"].forEach(n => h.append("Set-Cookie", clearCookie(n)));
  return h;
}

/* Supabase REST (PostgREST) with service role — server-side only, bypasses RLS */
export async function db(env, method, path, body) {
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/${path}`, {
    method,
    headers: {
      "apikey": env.SUPABASE_SERVICE_ROLE_KEY,
      "Authorization": `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      "Content-Type": "application/json",
      "Prefer": method === "POST" ? "return=representation,resolution=merge-duplicates" : "return=representation"
    },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const text = await res.text();
  let data = null; try { data = text ? JSON.parse(text) : null; } catch (e) {}
  return { ok: res.ok, status: res.status, data };
}

/* Supabase Auth endpoints */
export async function sbAuth(env, path, body, token) {
  const res = await fetch(`${env.SUPABASE_URL}/auth/v1/${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      "apikey": env.SUPABASE_ANON_KEY,
      "Authorization": `Bearer ${token || env.SUPABASE_ANON_KEY}`,
      "Content-Type": "application/json"
    },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  let data = null; try { data = await res.json(); } catch (e) {}
  return { ok: res.ok, status: res.status, data };
}
export async function sbAdmin(env, method, path, body) {
  const res = await fetch(`${env.SUPABASE_URL}/auth/v1/admin/${path}`, {
    method,
    headers: {
      "apikey": env.SUPABASE_SERVICE_ROLE_KEY,
      "Authorization": `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      "Content-Type": "application/json"
    },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  let data = null; try { data = await res.json(); } catch (e) {}
  return { ok: res.ok, status: res.status, data };
}

/* Resolve the signed-in user from cookies; auto-refresh expired access tokens.
   Also enforces the device/session limit by requiring a live active_sessions row. */
export async function requireUser(context) {
  const { request, env } = context;
  const c = getCookies(request);
  if (!c.sf_sid) return { error: json({ error: "Not signed in." }, 401) };

  let at = c.sf_at, refreshedHeaders = null;
  let u = at ? await sbAuth(env, "user", undefined, at) : { ok: false };
  if (!u.ok && c.sf_rt) {
    const r = await sbAuth(env, "token?grant_type=refresh_token", { refresh_token: c.sf_rt });
    if (r.ok && r.data && r.data.access_token) {
      at = r.data.access_token;
      refreshedHeaders = authCookieHeaders(r.data.access_token, r.data.refresh_token, c.sf_sid);
      u = await sbAuth(env, "user", undefined, at);
    }
  }
  if (!u.ok || !u.data || !u.data.id) return { error: json({ error: "Session expired — sign in again." }, 401, { "Set-Cookie": clearCookie("sf_at") }) };

  const sess = await db(env, "GET", `active_sessions?session_id=eq.${c.sf_sid}&user_id=eq.${u.data.id}&select=session_id`);
  if (!sess.ok || !sess.data || sess.data.length === 0) {
    return { error: json({ error: "This session was signed out (device limit). Sign in again." }, 401) };
  }
  db(env, "PATCH", `active_sessions?session_id=eq.${c.sf_sid}`, { last_seen: new Date().toISOString() });
  return { user: u.data, sid: c.sf_sid, accessToken: at, refreshedHeaders };
}

/* Create a session row, enforcing the concurrent-device cap (Brief §3). */
export async function openSession(env, userId) {
  const limit = parseInt(env.SESSION_LIMIT || "2", 10);
  const rows = await db(env, "GET", `active_sessions?user_id=eq.${userId}&select=session_id,created_at&order=created_at.asc`);
  if (rows.ok && rows.data && rows.data.length >= limit) {
    const evict = rows.data.slice(0, rows.data.length - limit + 1).map(r => r.session_id);
    await db(env, "DELETE", `active_sessions?session_id=in.(${evict.join(",")})`);
  }
  const ins = await db(env, "POST", "active_sessions", { user_id: userId });
  return ins.ok && ins.data && ins.data[0] ? ins.data[0].session_id : null;
}

export async function getSubscription(env, userId) {
  const r = await db(env, "GET", `subscriptions?user_id=eq.${userId}&select=status,tier`);
  return (r.ok && r.data && r.data[0]) ? r.data[0] : { status: "inactive", tier: "free" };
}

export function validEmail(e) { return typeof e === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) && e.length < 255; }
