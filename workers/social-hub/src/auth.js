/* Reads the Vault's own sessions. social-hub never creates a session and never sends a login
   email; it only recognises a session the Vault issued (same D1, same hashed cookie value).
   Roles: client (bound to one client_id) and admin (an email in ADMIN_EMAILS).
   The ScriptForge bridge and team-member sessions are deliberately not supported here. */
import { SESSION_COOKIE, getCookie, nowMs, normEmail, sha256hex } from "./util.js";

export function adminEmails(env) {
  return String(env.ADMIN_EMAILS || "").split(",").map(normEmail).filter(Boolean);
}

export async function getAuth(request, env) {
  const token = getCookie(request, SESSION_COOKIE);
  if (!token || token.length > 100) return null;
  const hash = await sha256hex(token);
  const s = await env.DB.prepare(
    "SELECT role, client_id, email FROM sessions WHERE session_hash = ? AND expires_at > ?"
  ).bind(hash, nowMs()).first();
  if (!s) return null;
  if (s.role === "admin") {
    if (!adminEmails(env).includes(normEmail(s.email))) return null;
    return { role: "admin", email: s.email, clientId: null, sessionHash: hash };
  }
  if (s.role === "client" && s.client_id) {
    return { role: "client", email: s.email, clientId: s.client_id, sessionHash: hash };
  }
  return null;
}

/* State-changing requests must come from our own site. */
export function originOk(request, env) {
  const origin = request.headers.get("Origin");
  return !!origin && origin === (env.SITE_ORIGIN || "https://tahastudiolabs.com");
}

/* Which client does this call act on? A client always acts on itself, whatever it sends.
   An admin must name the client explicitly. */
export function actingClientId(auth, requested) {
  if (auth.role === "client") return auth.clientId;
  return typeof requested === "string" && requested ? requested : null;
}
